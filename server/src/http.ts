import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Context, Next } from 'hono'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { env } from './env.js'
import { ingest, IngestError } from './ingest.js'
import { requireBearer } from './auth.js'
import { api } from './api.js'
import { publicRoutes } from './public.js'

export const app = new Hono()

// --- CORS: allowlist, not wildcard. ---------------------------------------
// The deployed app calls its own /api same-origin (no CORS needed), so this
// only governs CROSS-origin callers. Allow localhost dev + any origin set in
// ALLOWED_ORIGINS; deny everything else (no ACAO header → browser blocks it).
const DEV_ORIGINS = [
  'http://localhost:5173', 'http://localhost:5180', 'http://localhost:4173',
]
const ALLOWED_ORIGINS = new Set([
  ...DEV_ORIGINS,
  ...env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
])
app.use('*', cors({
  origin: (origin) => (origin && ALLOWED_ORIGINS.has(origin) ? origin : null),
  allowHeaders: ['authorization', 'content-type'],
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
}))

// --- Basic per-IP rate limiter --------------------------------------------
// Caps abusive bursts (cost/DoS) on the public endpoints. In-memory: solid for
// the persistent server, best-effort on serverless (per-instance) — but still
// caps any single hot instance. Normal use (owner poll ~30/min, a recruiter
// loading the world) is nowhere near the limit.
const RATE_LIMIT = 150          // requests
const RATE_WINDOW_MS = 60_000   // per minute, per IP
const hits = new Map<string, { count: number; reset: number }>()
const rateLimit = async (c: Context, next: Next): Promise<Response | void> => {
  const ip =
    c.req.header('x-nf-client-connection-ip') ||
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  const now = Date.now()
  if (hits.size > 10_000) {       // bound memory on the long-lived server
    for (const [k, v] of hits) if (now > v.reset) hits.delete(k)
  }
  let rec = hits.get(ip)
  if (!rec || now > rec.reset) { rec = { count: 0, reset: now + RATE_WINDOW_MS }; hits.set(ip, rec) }
  rec.count++
  if (rec.count > RATE_LIMIT) return c.json({ error: 'rate_limited' }, 429)
  await next()
}
app.use('*', rateLimit)

app.get('/healthz', (c) => c.json({ ok: true }))

// --- /ingest (write path) ---
app.use('/ingest', requireBearer)
app.post('/ingest', async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid_json' }, 400)
  }
  try {
    const result = await ingest(body)
    return c.json(result, 201)
  } catch (err) {
    if (err instanceof IngestError) {
      return c.json({ error: 'ingest_failed', issues: err.issues }, err.status)
    }
    console.error('Unexpected ingest error', err)
    return c.json({ error: 'internal_error' }, 500)
  }
})

// --- /api/* (read + manual edit, owner-only) ---
app.use('/api/*', requireBearer)
app.route('/api', api)

// --- /public/* (read-only, sanitized, NO auth — anon-keyed at the DB) ---
app.route('/public', publicRoutes)

// --- /ingest-form (no auth on the page; the form POSTs to /ingest with token) ---
const __dirname = dirname(fileURLToPath(import.meta.url))
const FORM_PATH = resolve(__dirname, '../public/ingest-form.html')

app.get('/ingest-form', async (c) => {
  const html = await readFile(FORM_PATH, 'utf8')
  return c.html(html)
})

