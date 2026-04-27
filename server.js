const http = require('http')
const puppeteer = require('puppeteer')

const PORT = process.env.PORT || 3000
const SECRET = process.env.PROXY_SECRET || 'sua-chave-secreta-aqui'

let browser = null

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
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-gpu',
      '--ignore-certificate-errors',
      '--allow-insecure-localhost',
    ],
  })
  console.log('[Proxy] Chromium pronto!')
  return browser
}

async function baixarAudioComChrome(audioUrl) {
  const browser = await getBrowser()
  const page = await browser.newPage()
  
  try {
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    )
    
    // ESTRATÉGIA: usa fetch dentro do contexto do browser
    // Primeiro navega para uma página inicial do TotalPhone para criar sessão
    console.log('[Proxy] Etapa 1: Acessando página inicial para criar sessão...')
    
    try {
      await page.goto('http://45.170.138.80/suite/', {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      })
      console.log('[Proxy] Página inicial carregada')
    } catch (e) {
      console.log('[Proxy] Erro ao carregar página inicial (pode ser ok):', e.message)
    }
    
    // Aguarda um pouco
    await new Promise(resolve => setTimeout(resolve, 1000))
    
    // Agora usa fetch DENTRO do browser para baixar o áudio
    // Como o fetch roda dentro do Chrome, ele usa o fingerprint TLS do Chrome
    console.log('[Proxy] Etapa 2: Baixando áudio via fetch do browser...')
    
    const audioBase64 = await page.evaluate(async (url) => {
      try {
        const response = await fetch(url, {
          method: 'GET',
          credentials: 'include', // envia cookies da sessão
          headers: {
            'Accept': 'audio/mpeg, audio/wav, audio/*, */*',
          },
        })
        
        if (!response.ok) {
          return { error: `HTTP ${response.status}`, contentType: response.headers.get('content-type') }
        }
        
        const contentType = response.headers.get('content-type') || ''
        if (contentType.includes('text/html')) {
          const text = await response.text()
          return { error: 'HTML retornado', contentType, preview: text.substring(0, 200) }
        }
        
        const buffer = await response.arrayBuffer()
        const bytes = new Uint8Array(buffer)
        
        // Converte para base64
        let binary = ''
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i])
        }
        const base64 = btoa(binary)
        
        return { 
          success: true, 
          base64, 
          size: bytes.length,
          contentType 
        }
      } catch (err) {
        return { error: err.message }
      }
    }, audioUrl)
    
    if (audioBase64.error) {
      console.error('[Proxy] Erro no fetch do browser:', audioBase64.error)
      if (audioBase64.preview) {
        console.error('[Proxy] Preview:', audioBase64.preview)
      }
      return null
    }
    
    if (audioBase64.success && audioBase64.base64) {
      const buffer = Buffer.from(audioBase64.base64, 'base64')
      console.log('[Proxy] Áudio baixado:', buffer.length, 'bytes, tipo:', audioBase64.contentType)
      return buffer
    }
    
    return null
    
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

  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok', engine: 'puppeteer-v3', timestamp: new Date().toISOString() }))
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
  console.log(`[Proxy TotalPhone v3 - Puppeteer fetch] Rodando na porta ${PORT}`)
})

process.on('SIGTERM', async () => {
  if (browser) await browser.close()
  process.exit(0)
})
