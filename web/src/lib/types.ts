export type ProjectStatus = 'seedling' | 'thriving' | 'active' | 'dormant'

export type ProjectStage = 'idea' | 'wip' | 'shipped' | 'archived'

export type EventType =
  | 'progress' | 'decision' | 'blocker' | 'spend' | 'next_step'
  | 'milestone' | 'metric' | 'status_change' | 'github_commit' | 'github_deploy' | 'note'

export type EventSource = 'claude_session' | 'claude_code' | 'github' | 'manual'

export interface ProjectState {
  id: string
  slug: string
  name: string
  category: string
  goal: string | null
  repo: string | null
  live_url: string | null
  tech_stack: string[]
  stage: ProjectStage
  manual_position: { x: number; y: number } | null
  created_at: string
  last_activity_ts: string | null
  status: ProjectStatus
  next_step: string | null
  commits_30d: number
  code_bytes?: number | null
}

export interface ProjectEvent {
  id: string
  project_id: string
  ts: string
  type: EventType
  summary: string
  payload: Record<string, unknown>
  source: EventSource
}

export interface ProjectMetric {
  project_id: string
  name: string
  value: unknown
  unit: string | null
  as_of: string
}

export interface ProjectDetail {
  project: ProjectState
  events: ProjectEvent[]
  metrics: ProjectMetric[]
  current_state: string | null
  spend_summary: {
    by_currency: Record<string, number>
    by_category: Record<string, number>
    by_vendor: Record<string, number>
    total_events: number
  }
}

export interface WorldSpendRow {
  project_category: string | null
  currency: string | null
  spend_category: string | null
  total: number
  event_count: number
}

export interface RecentEvent {
  id: string
  ts: string
  type: EventType
  summary: string
  payload: Record<string, unknown>
  source: EventSource
  project_id: string
  projects: { slug: string; name: string } | null
}

// Public (sanitized) shapes — see supabase/migrations/20260601000000_phase4_public.sql
export interface PublicProjectState {
  slug: string
  name: string
  category: string
  goal: string | null
  repo: string | null
  live_url: string | null
  tech_stack: string[]
  stage: ProjectStage
  status: ProjectStatus
  last_activity_ts: string | null
  created_at: string
  commits_30d: number
  code_bytes?: number | null
  /** True for anonymized "locked" private projects in the public world. */
  private?: boolean
}

export interface PublicEvent {
  id: string
  ts: string
  type: EventType
  summary: string
  project_slug?: string
  project_name?: string
}

export interface PublicProjectDetail {
  project: PublicProjectState
  events: PublicEvent[]
}

export interface NewProjectInput {
  slug: string
  name: string
  category?: string
  goal?: string
  repo?: string
  live_url?: string
  tech_stack?: string[]
}
