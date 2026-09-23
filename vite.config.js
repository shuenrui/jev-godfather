import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { adviceHandler } from './server/advice.js'

// Expose .env values (including non-VITE_ keys) to the API middleware.
function envPlugin() {
  return {
    name: 'jev-godfather-env',
    config(_, { mode }) {
      const env = loadEnv(mode, process.cwd(), '')
      for (const [key, value] of Object.entries(env)) {
        if (!(key in process.env)) process.env[key] = value
      }
    },
  }
}

const FORWARDED_HEADERS = [
  'content-type',
  'x-llm-api-key',
  'x-llm-base-url',
  'x-llm-model',
  'x-typesafe-api-key',
  'x-typesafe-base-url',
]

function adviceApiPlugin() {
  async function connectHandler(req, res) {
    try {
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      const payload = Buffer.concat(chunks)

      const headers = {}
      for (const name of FORWARDED_HEADERS) {
        const value = req.headers[name]
        if (typeof value === 'string' && value) headers[name] = value
      }
      if (!headers['content-type']) headers['content-type'] = 'application/json'

      const request = new Request('http://localhost/api/advice', {
        method: req.method || 'GET',
        headers,
        body: payload.length ? payload : undefined,
      })

      const response = await adviceHandler(request)
      res.statusCode = response.status
      response.headers.forEach((value, key) => res.setHeader(key, value))
      res.end(await response.text())
    } catch (error) {
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: error?.message || 'Internal server error' }))
    }
  }

  return {
    name: 'jev-godfather-advice-api',
    configureServer(server) {
      server.middlewares.use('/api/advice', connectHandler)
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/advice', connectHandler)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [envPlugin(), adviceApiPlugin(), react()],
})
