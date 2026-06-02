/**
 * Phase 0 integration smoke test.
 *
 * Hits the live ingest server + cloud DB. Creates an isolated test project
 * (slug prefixed with __verify_), exercises the contract, asserts the derived
 * views reflect what was written, then DELETEs the test project (which
 * cascade-removes the test events).
 *
 * Append-only invariant note: the verify project is a transient test fixture,
 * not real project history — deleting it (and its cascade events) is consistent
 * with "this run never happened." We never delete events of real projects.
 *
 * Requires: `pnpm dev` running in another terminal.
 */
import { env } from '../env.js'
import { supabase } from '../supabase.js'

const HOST = `http://localhost:${env.PORT}`
// Use a slug-shape identifier so auto-create stores it verbatim (the slugifier
// would otherwise strip leading/trailing punctuation and we'd lose track).
const SLUG = `verify-${Date.now()}`

type IngestResult = {
  event: { id: string; type: string; ts: string }
  project_state: { id: string; status: string; next_step: string | null } | null
}

function color(s: string, c: 'green' | 'red' | 'gray'): string {
  const codes = { green: 32, red: 31, gray: 90 }
  return `\x1b[${codes[c]}m${s}\x1b[0m`
}
function pass(msg: string): void { console.log(`${color('PASS', 'green')} ${msg}`) }
function fail(msg: string): never { console.error(`${color('FAIL', 'red')} ${msg}`); process.exit(1) }

async function post(body: unknown): Promise<IngestResult> {
  const res = await fetch(`${HOST}/ingest`, {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${env.INGEST_TOKEN}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) fail(`POST /ingest -> ${res.status}: ${text}`)
  return JSON.parse(text) as IngestResult
}

async function main(): Promise<void> {
  console.log(color(`> Phase 0 verify  (slug=${SLUG})`, 'gray'))

  const health = await fetch(`${HOST}/healthz`).catch(() => null)
  if (!health || !health.ok) fail('GET /healthz failed - is `pnpm dev` running?')
  pass('GET /healthz')

  const unauth = await fetch(`${HOST}/ingest`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
  if (unauth.status !== 401) fail(`expected 401 without token, got ${unauth.status}`)
  pass('POST /ingest without token -> 401')

  const badJson = await fetch(`${HOST}/ingest`, {
    method: 'POST',
    headers: { 'authorization': `Bearer ${env.INGEST_TOKEN}`, 'content-type': 'application/json' },
    body: '{',
  })
  if (badJson.status !== 400) fail(`expected 400 on bad JSON, got ${badJson.status}`)
  pass('POST /ingest with malformed JSON -> 400')

  const badType = await fetch(`${HOST}/ingest`, {
    method: 'POST',
    headers: { 'authorization': `Bearer ${env.INGEST_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ project: SLUG, type: 'nope', summary: 'x' }),
  })
  if (badType.status !== 400) fail(`expected 400 on unknown type, got ${badType.status}`)
  pass('POST /ingest with unknown type -> 400')

  const ns = await post({ project: SLUG, type: 'next_step', summary: 'verify next step', source: 'manual' })
  if (!ns.project_state) fail('project_state missing in response')
  if (ns.project_state.status !== 'seedling') fail(`expected status=seedling for new no-repo project, got ${ns.project_state.status}`)
  pass(`POST /ingest auto-created project (status=${ns.project_state.status})`)
  if (ns.project_state.next_step !== 'verify next step') fail(`project_state.next_step mismatch: ${ns.project_state.next_step}`)
  pass('project_state.next_step reflects latest next_step event')

  await post({ project: SLUG, type: 'spend',  summary: 'verify spend',  payload: { amount: 1.23, currency: 'USD' }, source: 'manual' })
  pass('POST /ingest spend event')

  await post({ project: SLUG, type: 'metric', summary: 'verify metric', payload: { name: 'verify_signal', value: 42 }, source: 'manual' })
  pass('POST /ingest metric event')

  const { data: metrics, error: mErr } = await supabase
    .from('project_metrics')
    .select('*')
    .eq('name', 'verify_signal')
  if (mErr) fail(`query project_metrics: ${mErr.message}`)
  if (!metrics || metrics.length === 0) fail('verify_signal metric not found in project_metrics view')
  pass(`project_metrics view returns the inserted metric (rows=${metrics.length})`)

  const { data: spends, error: sErr } = await supabase
    .from('world_spend')
    .select('*')
    .eq('currency', 'USD')
  if (sErr) fail(`query world_spend: ${sErr.message}`)
  if (!spends || spends.length === 0) fail('world_spend view returned no USD rows')
  pass(`world_spend view aggregates spend (rows=${spends.length})`)

  // --- /api/* read endpoints (Phase 1) ---
  const apiHeaders = { 'authorization': `Bearer ${env.INGEST_TOKEN}` }

  const apiUnauth = await fetch(`${HOST}/api/world`)
  if (apiUnauth.status !== 401) fail(`expected 401 on /api/world without token, got ${apiUnauth.status}`)
  pass('GET /api/world without token -> 401')

  const worldRes = await fetch(`${HOST}/api/world`, { headers: apiHeaders })
  if (!worldRes.ok) fail(`GET /api/world -> ${worldRes.status}`)
  const worldJson = (await worldRes.json()) as Array<{ slug: string; status: string }>
  if (!Array.isArray(worldJson)) fail('GET /api/world did not return an array')
  const inWorld = worldJson.find((p) => p.slug === SLUG)
  if (!inWorld) fail(`verify project ${SLUG} not present in /api/world`)
  pass(`GET /api/world contains ${SLUG} (status=${inWorld.status}, total projects=${worldJson.length})`)

  const projRes = await fetch(`${HOST}/api/project/${SLUG}`, { headers: apiHeaders })
  if (!projRes.ok) fail(`GET /api/project/${SLUG} -> ${projRes.status}`)
  const projJson = (await projRes.json()) as {
    project: { slug: string; next_step: string | null }
    events: Array<{ type: string }>
    metrics: Array<{ name: string }>
    spend_summary: { by_currency: Record<string, number>; total_events: number }
  }
  if (projJson.project.slug !== SLUG) fail('project payload slug mismatch')
  if (projJson.events.length < 3) fail(`expected >=3 events, got ${projJson.events.length}`)
  if (projJson.spend_summary.total_events !== 1) fail(`expected 1 spend event, got ${projJson.spend_summary.total_events}`)
  if (Math.abs((projJson.spend_summary.by_currency.USD ?? 0) - 1.23) > 0.001) fail('USD spend total mismatch')
  pass(`GET /api/project/${SLUG} returns project + events + metrics + spend_summary`)

  // POST /api/project (manual create)
  const manualSlug = `verify-manual-${Date.now()}`
  const createRes = await fetch(`${HOST}/api/project`, {
    method: 'POST',
    headers: { ...apiHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ slug: manualSlug, name: 'Manually created', category: 'web', tech_stack: ['react'] }),
  })
  if (createRes.status !== 201) fail(`POST /api/project -> ${createRes.status}: ${await createRes.text()}`)
  pass(`POST /api/project created ${manualSlug}`)

  // PATCH /api/project/:slug
  const patchRes = await fetch(`${HOST}/api/project/${manualSlug}`, {
    method: 'PATCH',
    headers: { ...apiHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ goal: 'updated goal' }),
  })
  if (!patchRes.ok) fail(`PATCH /api/project/${manualSlug} -> ${patchRes.status}: ${await patchRes.text()}`)
  const patched = (await patchRes.json()) as { goal: string | null }
  if (patched.goal !== 'updated goal') fail(`patch did not persist goal, got: ${patched.goal}`)
  pass(`PATCH /api/project/${manualSlug} updated goal`)

  // Cleanup both test projects
  const { error: delErr1 } = await supabase.from('projects').delete().eq('slug', SLUG)
  if (delErr1) fail(`cleanup ${SLUG} failed: ${delErr1.message}`)
  pass(`cleanup: deleted ${SLUG}`)

  const { error: delErr2 } = await supabase.from('projects').delete().eq('slug', manualSlug)
  if (delErr2) fail(`cleanup ${manualSlug} failed: ${delErr2.message}`)
  pass(`cleanup: deleted ${manualSlug}`)

  console.log(color('\nAll checks passed.', 'green'))
}

main().catch((err) => { console.error(err); process.exit(1) })
