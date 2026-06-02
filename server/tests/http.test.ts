import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock ingest BEFORE importing http
vi.mock('../src/ingest.js', () => {
  class IngestError extends Error {
    constructor(public readonly status: 400 | 401 | 404 | 500, public readonly issues?: unknown) {
      super(`IngestError ${status}`)
      this.name = 'IngestError'
    }
  }
  return {
    IngestError,
    ingest: vi.fn(async () => ({
      event: { id: 'evt_fake', type: 'progress', ts: new Date().toISOString() },
      project_state: { id: 'proj_fake', status: 'seedling', next_step: null },
    })),
  }
})

// Mock supabase so http (via env/supabase chain) doesn't actually talk to anything
vi.mock('../src/supabase.js', () => ({ supabase: {} }))

import { app } from '../src/http.js'
import { env } from '../src/env.js'
import { ingest, IngestError } from '../src/ingest.js'

describe('http', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('GET /healthz returns ok', async () => {
    const res = await app.request('/healthz')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean }
    expect(body.ok).toBe(true)
  })

  it('POST /ingest without bearer returns 401', async () => {
    const res = await app.request('/ingest', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    expect(res.status).toBe(401)
    expect(ingest).not.toHaveBeenCalled()
  })

  it('POST /ingest with wrong bearer returns 401', async () => {
    const res = await app.request('/ingest', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'authorization': 'Bearer wrong' },
      body: '{}',
    })
    expect(res.status).toBe(401)
    expect(ingest).not.toHaveBeenCalled()
  })

  it('POST /ingest with malformed JSON returns 400', async () => {
    const res = await app.request('/ingest', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'authorization': `Bearer ${env.INGEST_TOKEN}` },
      body: '{',
    })
    expect(res.status).toBe(400)
  })

  it('POST /ingest with valid bearer reaches ingest()', async () => {
    const res = await app.request('/ingest', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'authorization': `Bearer ${env.INGEST_TOKEN}` },
      body: JSON.stringify({ project: 'mockmate', type: 'progress', summary: 'test' }),
    })
    expect(res.status).toBe(201)
    expect(ingest).toHaveBeenCalledOnce()
    const body = (await res.json()) as { event: unknown; project_state: unknown }
    expect(body.event).toBeDefined()
    expect(body.project_state).toBeDefined()
  })

  it('POST /ingest surfaces IngestError status code', async () => {
    vi.mocked(ingest).mockRejectedValueOnce(new IngestError(400, { msg: 'bad' }))
    const res = await app.request('/ingest', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'authorization': `Bearer ${env.INGEST_TOKEN}` },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })

  it('GET /ingest-form returns the HTML page', async () => {
    const res = await app.request('/ingest-form')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    const html = await res.text()
    expect(html).toContain('project world')
    expect(html).toContain('Ingest token')
  })

  it('GET /api/world without bearer returns 401', async () => {
    const res = await app.request('/api/world')
    expect(res.status).toBe(401)
  })

  it('GET /api/project/foo without bearer returns 401', async () => {
    const res = await app.request('/api/project/foo')
    expect(res.status).toBe(401)
  })

  it('POST /api/project without bearer returns 401', async () => {
    const res = await app.request('/api/project', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 'x', name: 'X' }),
    })
    expect(res.status).toBe(401)
  })

  it('OPTIONS preflight returns 204', async () => {
    const res = await app.request('/api/world', { method: 'OPTIONS', headers: { origin: 'http://localhost:5173' } })
    expect(res.status).toBe(204)
  })
})
