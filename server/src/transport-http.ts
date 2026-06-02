import type { IncomingMessage, ServerResponse } from 'node:http'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { makeMcpServer } from './mcp.js'
import { bearerOk } from './auth.js'

// Stateful mode with per-session cache: routes follow-up requests
// (notifications/initialized, tools/call, etc.) to the same transport+server
// that handled the original `initialize`.
const sessions = new Map<string, { transport: StreamableHTTPServerTransport }>()

export async function handleMcpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!bearerOk(req.headers.authorization)) {
    res.statusCode = 401
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ error: 'unauthorized' }))
    return
  }

  const sessionId = req.headers['mcp-session-id']
  const sessionKey = Array.isArray(sessionId) ? sessionId[0] : sessionId

  const existing = sessionKey ? sessions.get(sessionKey) : undefined
  if (existing) {
    await existing.transport.handleRequest(req, res)
    return
  }

  // New session — instantiate transport + server, cache on init
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
    onsessioninitialized: (id) => { sessions.set(id, { transport }) },
  })
  transport.onclose = () => {
    if (transport.sessionId) sessions.delete(transport.sessionId)
  }
  const server = makeMcpServer()
  await server.connect(transport)
  await transport.handleRequest(req, res)
}
