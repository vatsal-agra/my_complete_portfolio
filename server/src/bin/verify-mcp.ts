/**
 * MCP smoke test against the live Streamable HTTP transport at /mcp.
 * Connects with the SDK client, lists tools, exercises all 4, cleans up.
 *
 * Requires: `pnpm dev` running in another terminal.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { env } from '../env.js'
import { supabase } from '../supabase.js'

const SLUG = `verify-mcp-${Date.now()}`

function color(s: string, c: 'green' | 'red' | 'gray'): string {
  const codes = { green: 32, red: 31, gray: 90 }
  return `\x1b[${codes[c]}m${s}\x1b[0m`
}
function pass(msg: string): void { console.log(`${color('PASS', 'green')} ${msg}`) }
function fail(msg: string): never { console.error(`${color('FAIL', 'red')} ${msg}`); process.exit(1) }

async function main(): Promise<void> {
  console.log(color(`> MCP verify  (slug=${SLUG})`, 'gray'))

  const transport = new StreamableHTTPClientTransport(
    new URL(`http://localhost:${env.PORT}/mcp`),
    {
      requestInit: { headers: { 'authorization': `Bearer ${env.INGEST_TOKEN}` } },
    },
  )
  const client = new Client({ name: 'verify-mcp', version: '0.1.0' })
  await client.connect(transport)
  pass('connected to /mcp')

  const { tools } = await client.listTools()
  const names = tools.map((t) => t.name).sort()
  const expected = ['list_projects', 'log_spend', 'log_update', 'set_next_step']
  for (const t of expected) {
    if (!names.includes(t)) fail(`tools/list missing: ${t} (got ${names.join(', ')})`)
  }
  pass(`tools/list returned all 4 tools (${names.join(', ')})`)

  const r1 = await client.callTool({
    name: 'log_update',
    arguments: { project: SLUG, type: 'progress', summary: 'mcp verify ping' },
  })
  if (r1.isError) fail(`log_update: ${JSON.stringify(r1)}`)
  pass('log_update created the project + event')

  const r2 = await client.callTool({ name: 'list_projects', arguments: {} })
  if (r2.isError) fail(`list_projects: ${JSON.stringify(r2)}`)
  pass('list_projects returned content')

  const r3 = await client.callTool({
    name: 'set_next_step',
    arguments: { project: SLUG, text: 'wire it all up' },
  })
  if (r3.isError) fail(`set_next_step: ${JSON.stringify(r3)}`)
  pass('set_next_step appended')

  const r4 = await client.callTool({
    name: 'log_spend',
    arguments: { project: SLUG, amount: 0.99, currency: 'USD', vendor: 'mcp-verify' },
  })
  if (r4.isError) fail(`log_spend: ${JSON.stringify(r4)}`)
  pass('log_spend appended')

  await client.close()

  const { error } = await supabase.from('projects').delete().eq('slug', SLUG)
  if (error) fail(`cleanup: ${error.message}`)
  pass(`cleanup: deleted ${SLUG}`)

  console.log(color('\nAll MCP checks passed.', 'green'))
}

main().catch((err) => { console.error(err); process.exit(1) })
