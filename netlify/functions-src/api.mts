/**
 * Netlify Function — serves the entire Hono backend.
 *
 * Bound (via `config.path`) to every backend route the SPA calls; everything
 * else falls through to the static app. Hono's `app.fetch` is a standard
 * (Request) => Response handler, which is exactly what a Netlify v2 function is.
 *
 * The hosted MCP HTTP transport is intentionally NOT included (serverless can't
 * keep its in-memory sessions) — the stdio MCP runs locally and is unaffected.
 */
import { app } from '../../server/dist/http.js'

export const config = {
  path: ['/api/*', '/ingest', '/public/*', '/healthz'],
}

export default async (request: Request): Promise<Response> => app.fetch(request)
