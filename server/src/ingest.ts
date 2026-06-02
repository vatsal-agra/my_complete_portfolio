import { supabase } from './supabase.js'
import { slugify } from './lib/slug.js'
import { IngestBody, EVENT_TYPES } from './types.js'

export class IngestError extends Error {
  constructor(public readonly status: 400 | 401 | 404 | 500, public readonly issues?: unknown) {
    super(`IngestError ${status}`)
    this.name = 'IngestError'
  }
}

/**
 * Validate, auto-create the project if needed, append the event, return
 * the inserted row + the project's freshly-queried project_state.
 * MCP tools call this in-process — no HTTP hop, no bearer token at this layer.
 */
export async function ingest(rawBody: unknown) {
  const parsed = IngestBody.safeParse(rawBody)
  if (!parsed.success) {
    const flat = parsed.error.flatten()
    return Promise.reject(new IngestError(400, {
      issues: flat,
      hint: `valid types: ${EVENT_TYPES.join(', ')}`,
    }))
  }
  const body = parsed.data

  const projectId = await resolveOrCreateProject(body.project)

  const insertRow: Record<string, unknown> = {
    project_id: projectId,
    type: body.type,
    summary: body.summary,
    payload: body.payload,
    source: body.source,
  }
  if (body.ts) insertRow.ts = body.ts

  const { data: event, error: insertErr } = await supabase
    .from('events')
    .insert(insertRow)
    .select('*')
    .single()

  if (insertErr || !event) {
    throw new IngestError(500, { dbError: insertErr?.message ?? 'insert returned no row' })
  }

  const { data: state } = await supabase
    .from('project_state')
    .select('*')
    .eq('id', projectId)
    .maybeSingle()

  return { event, project_state: state }
}

async function resolveOrCreateProject(identifier: string): Promise<string> {
  // 1. Match by exact slug
  const { data: bySlug } = await supabase
    .from('projects')
    .select('id')
    .eq('slug', identifier)
    .maybeSingle()
  if (bySlug) return bySlug.id

  // 2. Match by name (case-insensitive)
  const { data: byName } = await supabase
    .from('projects')
    .select('id')
    .ilike('name', identifier)
    .limit(1)
    .maybeSingle()
  if (byName) return byName.id

  // 3. Auto-create
  const slug = await ensureUniqueSlug(slugify(identifier))
  const { data: created, error } = await supabase
    .from('projects')
    .insert({ slug, name: identifier })
    .select('id')
    .single()
  if (error) {
    // 23505 = unique_violation — concurrent creator raced us. Refetch by slug.
    if ((error as { code?: string }).code === '23505') {
      const { data: raced } = await supabase
        .from('projects').select('id').eq('slug', slug).maybeSingle()
      if (raced) return raced.id
    }
    throw new IngestError(500, { dbError: error.message })
  }
  if (!created) {
    throw new IngestError(500, { dbError: 'insert returned no row' })
  }
  return created.id
}

async function ensureUniqueSlug(base: string): Promise<string> {
  const { data: collision } = await supabase
    .from('projects')
    .select('id')
    .eq('slug', base)
    .maybeSingle()
  if (!collision) return base
  return `${base}-${Date.now().toString(36).slice(-4)}`
}
