/**
 * Public read-only endpoints (PROJECT_SPEC §11).
 *
 * These routes use the ANON Supabase client. Privacy is enforced at the DB
 * layer: the anon key cannot SELECT from the raw `projects` / `events`
 * tables (RLS-locked, no anon policies). It can only read through the
 * `public_project_state` and `public_events` views — which deliberately
 * exclude money/spend, metrics, decisions, blockers, notes, next_step,
 * manual_position, and internal ids.
 *
 * Even if an attacker grabs the anon key from the web bundle and hits
 * the Supabase REST API directly, they see only what these views expose.
 */
import { Hono } from 'hono'
import { supabaseAnon } from './supabase.js'

export const publicRoutes = new Hono()

publicRoutes.get('/world', async (c) => {
  const { data, error } = await supabaseAnon
    .from('public_project_state')
    .select('*')
    .order('last_activity_ts', { ascending: false, nullsFirst: false })
  if (error) return c.json({ error: error.message }, 500)
  return c.json(data ?? [])
})

publicRoutes.get('/project/:slug', async (c) => {
  const slug = c.req.param('slug')
  const { data: project, error: pErr } = await supabaseAnon
    .from('public_project_state')
    .select('*')
    .eq('slug', slug)
    .maybeSingle()
  if (pErr) return c.json({ error: pErr.message }, 500)
  if (!project) return c.json({ error: 'not_found' }, 404)

  const { data: events, error: eErr } = await supabaseAnon
    .from('public_events')
    .select('id, ts, type, summary, project_slug')
    .eq('project_slug', slug)
    .order('ts', { ascending: false })
    .limit(200)
  if (eErr) return c.json({ error: eErr.message }, 500)

  return c.json({ project, events: events ?? [] })
})

publicRoutes.get('/events/recent', async (c) => {
  const limit = Math.min(50, Number(c.req.query('limit') ?? 20))
  const { data, error } = await supabaseAnon
    .from('public_events')
    .select('id, ts, type, summary, project_slug, project_name')
    .order('ts', { ascending: false })
    .limit(limit)
  if (error) return c.json({ error: error.message }, 500)
  return c.json(data ?? [])
})
