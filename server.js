const http = require('http')
const puppeteer = require('puppeteer')

const PORT = process.env.PORT || 3000
const SECRET = process.env.PROXY_SECRET || 'sua-chave-secreta-aqui'

let browser = null

// Inicializa o browser uma única vez (reutiliza)
async function getBrowser() {
  if (browser && browser.isConnected()) {
    return browser
  }
  
  console.log('[Proxy] Inicializando Chromium...')
  browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-gpu',
      '--ignore-certificate-errors',
      '--ignore-certificate-errors-spki-list',
      '--allow-insecure-localhost',
    ],
  })
  console.log('[Proxy] Chromium pronto!')
  return browser
}

// Função para baixar áudio com Chrome real
async function baixarAudioComChrome(audioUrl) {
  const browser = await getBrowser()
  const page = await browser.newPage()
  
  try {
    // Configura User-Agent realista
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    )
    
    // Configura para capturar a resposta de áudio
    let audioBuffer = null
    
    page.on('response', async (response) => {
      const contentType = response.headers()['content-type'] || ''
      const url = response.url()
      
      // Captura apenas a resposta do áudio (não HTML)
      if (url.includes('download_audio.php') && !contentType.includes('text/html')) {
        try {
          const buffer = await response.buffer()
          if (buffer.length > 1024) {
            audioBuffer = buffer
            console.log('[Proxy] Áudio capturado:', buffer.length, 'bytes, tipo:', contentType)
          }
        } catch (e) {
          console.error('[Proxy] Erro ao capturar buffer:', e.message)
        }
      }
    })
    
    // Navega para a URL do áudio
    console.log('[Proxy] Navegando para a URL do áudio...')
    
    try {
      await page.goto(audioUrl, {
        waitUntil: 'networkidle0',
        timeout: 30000,
      })
    } catch (gotoError) {
      // Erro de navegação é esperado para downloads (Chrome pode lançar)
      console.log('[Proxy] Goto terminou (esperado para download):', gotoError.message)
    }
    
    // Aguarda um pouco caso o download esteja em progresso
    await new Promise(resolve => setTimeout(resolve, 2000))
    
    return audioBuffer
    
  } finally {
    await page.close()
  }
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') {
    res.writeHead(200)
    res.end()
    return
  }

  // Health check
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok', engine: 'puppeteer', timestamp: new Date().toISOString() }))
    return
  }

  if (req.url?.startsWith('/download')) {
    try {
      const urlParams = new URL(req.url, `http://localhost:${PORT}`)
      const audioUrl = urlParams.searchParams.get('url')
      const authHeader = req.headers['authorization']

      if (authHeader !== `Bearer ${SECRET}`) {
        res.writeHead(401, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Não autorizado' }))
        return
      }

      if (!audioUrl) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'URL do áudio não fornecida' }))
        return
      }

      console.log('[Proxy] Baixando:', audioUrl.substring(0, 80) + '...')
      
      const audioBuffer = await baixarAudioComChrome(audioUrl)

      if (!audioBuffer || audioBuffer.length < 1024) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ 
          error: 'Não foi possível baixar o áudio',
          bytes: audioBuffer?.length || 0
        }))
        return
      }

      console.log('[Proxy] Áudio retornado:', audioBuffer.length, 'bytes')

      res.writeHead(200, {
        'Content-Type': 'audio/wav',
        'Content-Length': audioBuffer.length,
      })
      res.end(audioBuffer)

    } catch (error) {
      console.error('[Proxy] Erro:', error.message)
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: error.message }))
    }
    return
  }

  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'Rota não encontrada' }))
})

server.listen(PORT, () => {
  console.log(`[Proxy TotalPhone v2 - Puppeteer] Rodando na porta ${PORT}`)
})

// Cleanup ao fechar
process.on('SIGTERM', async () => {
  if (browser) await browser.close()
  process.exit(0)
})
