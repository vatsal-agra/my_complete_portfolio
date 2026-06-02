import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { ingest, IngestError } from './ingest.js'
import { requireBearer } from './auth.js'
import { api } from './api.js'
import { publicRoutes } from './public.js'

export const app = new Hono()

// Permissive CORS for owner workflows on localhost; tighten in production.
app.use('*', cors({
  origin: (origin) => origin ?? '*',
  allowHeaders: ['authorization', 'content-type'],
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  credentials: true,
}))

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

