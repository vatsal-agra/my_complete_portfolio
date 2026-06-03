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
  startGithubSyncScheduler()
})

/**
 * Background GitHub sync: every GITHUB_SYNC_MINUTES, discover new repos and
 * pull new commits/releases so the world updates itself without manual runs.
 * Disabled unless a GITHUB_TOKEN is set (anon rate limits make polling 17+
 * repos every half hour impractical). An in-flight guard prevents overlap.
 */
function startGithubSyncScheduler(): void {
  const minutes = env.GITHUB_SYNC_MINUTES
  if (minutes <= 0) {
    console.log('  ⏸ github auto-sync disabled (GITHUB_SYNC_MINUTES=0)')
    return
  }
  if (!env.GITHUB_TOKEN) {
    console.log('  ⏸ github auto-sync idle — set GITHUB_TOKEN (repo scope) to enable')
    return
  }

  let running = false
  const runOnce = async (trigger: string) => {
    if (running) return
    running = true
    try {
      const { runGithubSync } = await import('../github.js')
      const s = await runGithubSync()
      const commits = s.pull.results.reduce((n, r) => n + r.commits_added, 0)
      const releases = s.pull.results.reduce((n, r) => n + r.releases_added, 0)
      console.log(`  🔄 github sync (${trigger}): +${s.discover.created.length} repos, +${commits} commits, +${releases} releases`)
    } catch (err) {
      console.error('  ⚠ github sync failed:', err instanceof Error ? err.message : err)
    } finally {
      running = false
    }
  }

  console.log(`  🔄 github auto-sync every ${minutes}m`)
  // First pass shortly after boot, then on the interval.
  setTimeout(() => void runOnce('startup'), 10_000)
  setInterval(() => void runOnce('interval'), minutes * 60_000)
}
