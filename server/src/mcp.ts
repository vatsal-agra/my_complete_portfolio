import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { supabase } from './supabase.js'
import { ingest } from './ingest.js'
import { EVENT_TYPES } from './types.js'

export function makeMcpServer(): McpServer {
  const server = new McpServer({
    name: 'project-world',
    version: '0.1.0',
  })

  server.tool(
    'log_update',
    'Append an event to a project. Auto-creates the project if no slug/name matches.',
    {
      project: z.string().describe('Project slug or display name'),
      type: z.enum(EVENT_TYPES).describe('Event type'),
      summary: z.string().describe('One-line human-readable summary'),
      payload: z.record(z.string(), z.unknown()).optional().describe('Type-specific structured data'),
    },
    async ({ project, type, summary, payload }) => {
      const result = await ingest({
        project, type, summary,
        payload: payload ?? {},
        source: 'claude_session',
      })
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    },
  )

  server.tool(
    'list_projects',
    'List all non-archived projects with their current status, last activity, and next step.',
    {},
    async () => {
      const { data, error } = await supabase
        .from('project_state')
        .select('slug, name, status, last_activity_ts, next_step')
        .order('last_activity_ts', { ascending: false, nullsFirst: false })
      if (error) throw new Error(error.message)
      return { content: [{ type: 'text', text: JSON.stringify(data ?? [], null, 2) }] }
    },
  )

  server.tool(
    'set_next_step',
    'Set the next step for a project (appends a next_step event).',
    {
      project: z.string().describe('Project slug or display name'),
      text: z.string().describe('The next step, in one sentence'),
    },
    async ({ project, text }) => {
      const result = await ingest({
        project, type: 'next_step', summary: text,
        payload: {}, source: 'claude_session',
      })
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    },
  )

  server.tool(
    'log_spend',
    'Record a money spend for a project (GPU rental, API bill, domain, etc.).',
    {
      project: z.string().describe('Project slug or display name'),
      amount: z.number().nonnegative().describe('Amount spent'),
      currency: z.string().min(1).max(8).describe('Currency code (USD, INR, EUR, ...)'),
      vendor: z.string().optional().describe('Where it was spent (RunPod, OpenAI, ...)'),
      category: z.string().optional().describe('Bucket (compute, llm, domain, hosting, ...)'),
      note: z.string().optional(),
    },
    async ({ project, amount, currency, vendor, category, note }) => {
      const summary = note ?? `${amount} ${currency}${vendor ? ` to ${vendor}` : ''}`
      const result = await ingest({
        project, type: 'spend', summary,
        payload: { amount, currency, vendor, category, note },
        source: 'claude_session',
      })
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    },
  )

  return server
}
