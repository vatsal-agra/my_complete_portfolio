import { timingSafeEqual } from 'node:crypto'
import type { Context, Next } from 'hono'
import { env } from './env.js'

export function bearerOk(header: string | undefined): boolean {
  if (!header) return false
  const expected = `Bearer ${env.INGEST_TOKEN}`
  const a = Buffer.from(header)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export const requireBearer = async (c: Context, next: Next): Promise<Response | void> => {
  // CORS preflight always passes through — the actual request will be auth'd.
  if (c.req.method === 'OPTIONS') return next()
  if (!bearerOk(c.req.header('authorization'))) {
    return c.json({ error: 'unauthorized' }, 401)
  }
  await next()
}
