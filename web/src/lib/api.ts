import { getToken, clearToken } from './auth'
import type {
  ProjectState, ProjectDetail, ProjectEvent, NewProjectInput, ProjectStage,
  WorldSpendRow, RecentEvent,
  PublicProjectState, PublicProjectDetail, PublicEvent,
} from './types'

class ApiError extends Error {
  constructor(public readonly status: number, public readonly body: unknown) {
    super(`API ${status}`)
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken()
  if (!token) throw new ApiError(401, { error: 'missing_token' })
  const res = await fetch(path, {
    ...init,
    headers: {
      'authorization': `Bearer ${token}`,
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  })
  if (res.status === 401) {
    clearToken()
    throw new ApiError(401, { error: 'unauthorized' })
  }
  const text = await res.text()
  const body = text ? safeJsonParse(text) : null
  if (!res.ok) throw new ApiError(res.status, body)
  return body as T
}

function safeJsonParse(text: string): unknown {
  try { return JSON.parse(text) } catch { return text }
}

// Owner-side API (Bearer-token gated).
export const api = {
  world: () => call<ProjectState[]>('/api/world'),
  worldSpend: () => call<WorldSpendRow[]>('/api/world/spend'),
  project: (slug: string) => call<ProjectDetail>(`/api/project/${encodeURIComponent(slug)}`),
  events: (limit = 5000) => call<ProjectEvent[]>(`/api/events?limit=${limit}`),
  recentEvents: (limit = 20) => call<RecentEvent[]>(`/api/events/recent?limit=${limit}`),
  createProject: (input: NewProjectInput) =>
    call<ProjectState>('/api/project', { method: 'POST', body: JSON.stringify(input) }),
  patchProject: (slug: string, patch: Partial<NewProjectInput & { stage: ProjectStage; archived: boolean; manual_position: { x: number; y: number } | null }>) =>
    call<ProjectState>(`/api/project/${encodeURIComponent(slug)}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  triggerGithubPull: () => call<{ ok: true; scanned: number; results: unknown[] }>('/api/pull/github', { method: 'POST' }),
  // Full owner-triggered sync: discover new repos + pull commits/releases/size.
  triggerGithubSync: () => call<{
    ok: true
    discover: { created: unknown[]; updated: unknown[] }
    pull: { scanned: number; results: Array<{ commits_added: number; releases_added: number; code_bytes?: number }> }
  }>('/api/pull/github/sync', { method: 'POST' }),
  ingest: (body: { project: string; type: string; summary: string; payload?: Record<string, unknown>; source?: string }) =>
    call<{ event: unknown; project_state: ProjectState | null }>('/ingest', { method: 'POST', body: JSON.stringify({ source: 'manual', ...body }) }),
}

// Public sanitized API (no auth).
async function publicCall<T>(path: string): Promise<T> {
  const res = await fetch(path)
  if (!res.ok) throw new ApiError(res.status, await res.text())
  return res.json() as Promise<T>
}

export const publicApi = {
  world:        () => publicCall<PublicProjectState[]>('/public/world'),
  project:      (slug: string) => publicCall<PublicProjectDetail>(`/public/project/${encodeURIComponent(slug)}`),
  recentEvents: (limit = 20) => publicCall<PublicEvent[]>(`/public/events/recent?limit=${limit}`),
}

export { ApiError }
