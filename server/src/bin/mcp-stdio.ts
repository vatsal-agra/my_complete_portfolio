import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { makeMcpServer } from '../mcp.js'

const server = makeMcpServer()
const transport = new StdioServerTransport()
await server.connect(transport)
// Process stays alive as long as stdin is open (transport reads it).
