import { Hono } from 'hono'
import { supabase } from './supabase.js'
import { ProjectCreate, ProjectPatch } from './types.js'
import type { EventRow } from './types.js'

export const api = new Hono()

api.get('/world', async (c) => {
  const { data, error } = await supabase
    .from('project_state')
    .select('*')
    .order('last_activity_ts', { ascending: false, nullsFirst: false })
  if (error) return c.json({ error: error.message }, 500)
  return c.json(data ?? [])
})

api.get('/project/:slug', async (c) => {
  const slug = c.req.param('slug')

  const { data: project, error: pErr } = await supabase
    .from('project_state').select('*').eq('slug', slug).maybeSingle()
  if (pErr) return c.json({ error: pErr.message }, 500)
  if (!project) return c.json({ error: 'not_found' }, 404)

  const [eventsRes, metricsRes] = await Promise.all([
    supabase.from('events').select('*').eq('project_id', project.id).order('ts', { ascending: false }).limit(200),
    supabase.from('project_metrics').select('*').eq('project_id', project.id),
  ])
  if (eventsRes.error)  return c.json({ error: eventsRes.error.message }, 500)
  if (metricsRes.error) return c.json({ error: metricsRes.error.message }, 500)

  const events = (eventsRes.data ?? []) as EventRow[]
  const spendEvents = events.filter((e) => e.type === 'spend')
  const byCurrency: Record<string, number> = {}
  const byCategory: Record<string, number> = {}
  const byVendor: Record<string, number> = {}
  for (const e of spendEvents) {
    const p = e.payload as { amount?: number; currency?: string; category?: string; vendor?: string }
    if (typeof p.amount === 'number' && typeof p.currency === 'string') {
      byCurrency[p.currency] = (byCurrency[p.currency] ?? 0) + p.amount
      if (typeof p.category === 'string') {
        byCategory[p.category] = (byCategory[p.category] ?? 0) + p.amount
      }
      if (typeof p.vendor === 'string') {
        byVendor[p.vendor] = (byVendor[p.vendor] ?? 0) + p.amount
      }
    }
  }

  // "Current state" derivation: latest progress/milestone/decision summary.
  const currentState = events.find((e) => e.type === 'progress' || e.type === 'milestone' || e.type === 'decision')?.summary ?? null

  return c.json({
    project,
    events,
    metrics: metricsRes.data ?? [],
    current_state: currentState,
    spend_summary: { by_currency: byCurrency, by_category: byCategory, by_vendor: byVendor, total_events: spendEvents.length },
  })
})

api.post('/project', async (c) => {
  let raw: unknown
  try { raw = await c.req.json() } catch { return c.json({ error: 'invalid_json' }, 400) }
  const parsed = ProjectCreate.safeParse(raw)
  if (!parsed.success) return c.json({ error: 'validation', issues: parsed.error.flatten() }, 400)

  const { data, error } = await supabase
    .from('projects')
    .insert(parsed.data)
    .select('*').single()
  if (error) {
    if ((error as { code?: string }).code === '23505') return c.json({ error: 'slug_taken' }, 409)
    return c.json({ error: error.message }, 500)
  }

  const { data: state } = await supabase.from('project_state').select('*').eq('id', data.id).maybeSingle()
  return c.json(state ?? data, 201)
})

api.patch('/project/:slug', async (c) => {
  const slug = c.req.param('slug')
  let raw: unknown
  try { raw = await c.req.json() } catch { return c.json({ error: 'invalid_json' }, 400) }
  const parsed = ProjectPatch.safeParse(raw)
  if (!parsed.success) return c.json({ error: 'validation', issues: parsed.error.flatten() }, 400)
  if (Object.keys(parsed.data).length === 0) return c.json({ error: 'empty_patch' }, 400)

  const { data, error } = await supabase
    .from('projects')
    .update(parsed.data)
    .eq('slug', slug)
    .select('*').single()
  if (error) return c.json({ error: error.message }, 500)
  if (!data) return c.json({ error: 'not_found' }, 404)

  const { data: state } = await supabase.from('project_state').select('*').eq('id', data.id).maybeSingle()
  return c.json(state ?? data)
})

api.get('/world/spend', async (c) => {
  const { data, error } = await supabase.from('world_spend').select('*')
  if (error) return c.json({ error: error.message }, 500)
  return c.json(data ?? [])
})

// Full event stream for owner-side time-travel (Phase 4). Cap to keep
// the payload reasonable; for solo use this is well under the limit.
api.get('/events', async (c) => {
  const limit = Math.min(10000, Number(c.req.query('limit') ?? 5000))
  const { data, error } = await supabase
    .from('events')
    .select('id, project_id, ts, type, summary, payload, source')
    .order('ts', { ascending: true })
    .limit(limit)
  if (error) return c.json({ error: error.message }, 500)
  return c.json(data ?? [])
})

// Recent events across all projects (powers the ticker).
api.get('/events/recent', async (c) => {
  const limit = Math.min(50, Number(c.req.query('limit') ?? 20))
  const { data, error } = await supabase
    .from('events')
    .select('id, ts, type, summary, payload, source, project_id, projects(slug, name)')
    .order('ts', { ascending: false })
    .limit(limit)
  if (error) return c.json({ error: error.message }, 500)
  return c.json(data ?? [])
})

// Trigger the GitHub pull worker on demand. Returns a summary.
api.post('/pull/github', async (c) => {
  const { runGithubPull } = await import('./github.js')
  try {
    const summary = await runGithubPull()
    return c.json(summary)
  } catch (err) {
    console.error('github pull failed', err)
    return c.json({ error: 'pull_failed', detail: err instanceof Error ? err.message : String(err) }, 500)
  }
})

// Discover all repos under GITHUB_USERNAME and create new project rows.
// Existing projects (matched by `repo`) are skipped.
api.post('/pull/github/discover', async (c) => {
  const { discoverRepos } = await import('./github.js')
  try {
    const summary = await discoverRepos()
    return c.json(summary)
  } catch (err) {
    console.error('github discover failed', err)
    return c.json({ error: 'discover_failed', detail: err instanceof Error ? err.message : String(err) }, 500)
  }
})

// Full sync on demand: discover new repos + pull commits/releases. Same work
// the background scheduler does, exposed for a manual kick.
api.post('/pull/github/sync', async (c) => {
  const { runGithubSync } = await import('./github.js')
  try {
    const summary = await runGithubSync()
    return c.json(summary)
  } catch (err) {
    console.error('github sync failed', err)
    return c.json({ error: 'sync_failed', detail: err instanceof Error ? err.message : String(err) }, 500)
  }
})

// Incremental sync: one batch of N projects per call so we never trip the
// Netlify function timeout, no matter how many repos need backfilling. The
// frontend loops until `done: true`. On the first call (offset === 0) we
// also run discover so new repos appear before the batches start pulling
// their commits.
api.post('/pull/github/sync-batch', async (c) => {
  const offset = Math.max(0, Number(c.req.query('offset') ?? 0))
  const batch  = Math.max(1, Math.min(10, Number(c.req.query('batch') ?? 5)))
  const { runGithubPullBatch, discoverRepos } = await import('./github.js')
  try {
    let discover = null
    if (offset === 0) discover = await discoverRepos()
    const pull = await runGithubPullBatch(offset, batch)
    return c.json({ ok: true, discover, pull })
  } catch (err) {
    console.error('github sync-batch failed', err)
    return c.json({ error: 'sync_batch_failed', detail: err instanceof Error ? err.message : String(err) }, 500)
  }
})

// Diagnostic: what does GitHub *currently* report for one repo, and what
// would we compute as code_bytes? Read-only — never writes events. Useful
// when a project's tower height doesn't look right ("why is this huge repo
// rendering tiny?"). Returns the raw langMap, repo.size_kb, and the
// max-based code_bytes the next sync would record.
api.get('/pull/github/probe/:slug', async (c) => {
  const slug = c.req.param('slug')
  const { data: project, error: pErr } = await supabase
    .from('projects').select('id, slug, repo').eq('slug', slug).maybeSingle()
  if (pErr) return c.json({ error: pErr.message }, 500)
  if (!project) return c.json({ error: 'not_found' }, 404)
  if (!project.repo) return c.json({ error: 'no_repo' }, 400)

  const { probeRepoSize } = await import('./github.js')
  try {
    const probe = await probeRepoSize(project.repo, project.id)
    return c.json({ slug, repo: project.repo, ...probe })
  } catch (err) {
    return c.json({ error: 'probe_failed', detail: err instanceof Error ? err.message : String(err) }, 500)
  }
})
