import { createServer } from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { adviceHandler } from './advice.js'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const DIST = resolve(__dirname, '..', 'dist')
const PORT = Number(process.env.PORT) || 8080

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(data))
}

function serveStatic(req, res, pathname) {
  if (!existsSync(DIST)) {
    sendJson(res, 503, { error: 'Build not found. Run npm run build first.' })
    return
  }

  const decoded = decodeURIComponent(pathname)
  const candidate = resolve(join(DIST, normalize(decoded)))

  if (candidate !== DIST && !candidate.startsWith(DIST + sep)) {
    sendJson(res, 403, { error: 'Forbidden' })
    return
  }

  const isFile = existsSync(candidate) && statSync(candidate).isFile()
  const file = isFile ? candidate : join(DIST, 'index.html')
  const ext = extname(file)
  const immutable = file.includes(`${sep}assets${sep}`)

  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  })
  createReadStream(file).pipe(res)
}

const server = createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)

    if (pathname === '/api/advice') {
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      const payload = Buffer.concat(chunks)

      const headers = {}
      for (const name of ['content-type', 'x-llm-api-key', 'x-llm-base-url', 'x-llm-model', 'x-typesafe-api-key', 'x-typesafe-base-url']) {
        const value = req.headers[name]
        if (typeof value === 'string' && value) headers[name] = value
      }
      if (!headers['content-type']) headers['content-type'] = 'application/json'

      const request = new Request(`http://localhost${pathname}`, {
        method: req.method || 'GET',
        headers,
        body: payload.length ? payload : undefined,
      })

      const response = await adviceHandler(request)
      res.writeHead(response.status, Object.fromEntries(response.headers))
      res.end(await response.text())
      return
    }

    if (pathname === '/healthz') {
      sendJson(res, 200, { ok: true })
      return
    }

    serveStatic(req, res, pathname)
  } catch (error) {
    sendJson(res, 500, { error: error?.message || 'Internal server error' })
  }
})

server.listen(PORT, () => {
  console.log(`Jev Godfather listening on :${PORT}`)
})
