/**
 * Netlify Scheduled Function — runs the GitHub sync once a day in the cloud
 * (discover new repos + pull commits/releases/code-size + reconcile private/
 * archived/renamed). Replaces the in-process interval, which serverless can't
 * keep alive. Trigger on demand from the dashboard or via the owner Refresh
 * button (which calls POST /api/pull/github/sync).
 */
import { runGithubSync } from '../../server/dist/github.js'

export const config = {
  schedule: '@daily',
}

export default async (): Promise<Response> => {
  try {
    const s = await runGithubSync()
    const created = s.discover.created.length
    const updated = s.discover.updated.length
    const commits = s.pull.results.reduce((n, r) => n + r.commits_added, 0)
    console.log(`github sync: +${created} repos, ~${updated} reconciled, +${commits} commits`)
    return new Response(JSON.stringify({ ok: true, created, updated, commits }), {
      headers: { 'content-type': 'application/json' },
    })
  } catch (e) {
    console.error('scheduled github sync failed', e)
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500 })
  }
}
