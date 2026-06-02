import { createServer } from 'node:http'
import { getRequestListener } from '@hono/node-server'
import { app } from '../http.js'
import { handleMcpRequest } from '../transport-http.js'
import { env } from '../env.js'

const honoListener = getRequestListener(app.fetch)

const server = createServer((req, res) => {
  const url = req.url ?? ''
  if (url === '/mcp' || url.startsWith('/mcp?') || url.startsWith('/mcp/')) {
    void handleMcpRequest(req, res)
    return
  }
  void honoListener(req, res)
})

server.listen(env.PORT, () => {
  console.log(`▶ project-world server listening on http://localhost:${env.PORT}`)
  console.log(`  POST /ingest       (auth: Bearer ...)`)
  console.log(`  GET  /ingest-form  (fallback web form)`)
  console.log(`  GET  /healthz`)
  console.log(`  ANY  /mcp          (MCP Streamable HTTP, auth: Bearer ...)`)
})
