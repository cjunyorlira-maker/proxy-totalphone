const http = require('http')

const PORT = process.env.PORT || 3000
const SECRET = process.env.PROXY_SECRET || 'sua-chave-secreta-aqui'

// Servidor proxy para baixar áudios do TotalPhone
const server = http.createServer(async (req, res) => {
  // CORS headers
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
    res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }))
    return
  }

  // Endpoint principal: /download?url=...
  if (req.url?.startsWith('/download')) {
    try {
      const urlParams = new URL(req.url, `http://localhost:${PORT}`)
      const audioUrl = urlParams.searchParams.get('url')
      const authHeader = req.headers['authorization']

      // Valida autenticação
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

      // Faz requisição para o TotalPhone
      const parsedUrl = new URL(audioUrl)
      
      const opcoes = {
        hostname: parsedUrl.hostname,
        port: 80,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'audio/mpeg, audio/wav, audio/*, */*',
          'Accept-Language': 'pt-BR,pt;q=0.9',
          'Referer': 'http://45.170.138.80/suite/',
        },
      }

      // PASSO 1: Primeira requisição para obter PHPSESSID
      const cookies = await new Promise((resolve, reject) => {
        const req1 = http.request(opcoes, (res1) => {
          console.log('[Proxy] REQ1 Status:', res1.statusCode)
          const setCookies = res1.headers['set-cookie'] || []
          res1.resume() // descarta body
          resolve(setCookies)
        })
        req1.on('error', reject)
        req1.setTimeout(15000, () => { req1.destroy(); reject(new Error('Timeout REQ1')) })
        req1.end()
      })

      const phpSession = cookies.find(c => c.startsWith('PHPSESSID='))?.split(';')[0] || ''
      const idioma = cookies.find(c => c.startsWith('idioma='))?.split(';')[0] || 'idioma=pt'

      console.log('[Proxy] PHPSESSID:', phpSession.substring(0, 30))

      if (!phpSession) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'PHPSESSID não obtido' }))
        return
      }

      // PASSO 2: Segunda requisição com cookie
      const opcoes2 = {
        ...opcoes,
        headers: {
          ...opcoes.headers,
          'Cookie': `${phpSession}; ${idioma}`,
        },
      }

      const audioBuffer = await new Promise((resolve, reject) => {
        const req2 = http.request(opcoes2, (res2) => {
          console.log('[Proxy] REQ2 Status:', res2.statusCode)
          console.log('[Proxy] REQ2 Content-Type:', res2.headers['content-type'])

          const contentType = res2.headers['content-type'] || ''
          if (contentType.includes('text/html')) {
            res2.resume()
            reject(new Error('Servidor retornou HTML'))
            return
          }

          const chunks = []
          res2.on('data', chunk => chunks.push(chunk))
          res2.on('end', () => resolve(Buffer.concat(chunks)))
          res2.on('error', reject)
        })
        req2.on('error', reject)
        req2.setTimeout(30000, () => { req2.destroy(); reject(new Error('Timeout REQ2')) })
        req2.end()
      })

      console.log('[Proxy] Áudio baixado:', audioBuffer.length, 'bytes')

      if (audioBuffer.length < 1024) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Áudio muito pequeno', bytes: audioBuffer.length }))
        return
      }

      // Retorna o áudio
      res.writeHead(200, {
        'Content-Type': 'audio/mpeg',
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

  // 404 para outras rotas
  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'Rota não encontrada' }))
})

server.listen(PORT, () => {
  console.log(`[Proxy TotalPhone] Rodando na porta ${PORT}`)
})
