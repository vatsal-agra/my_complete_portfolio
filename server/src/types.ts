import { z } from 'zod'

export const EVENT_TYPES = [
  'progress',
  'decision',
  'blocker',
  'spend',
  'next_step',
  'milestone',
  'metric',
  'status_change',
  'github_commit',
  'github_deploy',
  'note',
] as const

export const EVENT_SOURCES = [
  'claude_session',
  'claude_code',
  'github',
  'manual',
] as const

export type EventType = (typeof EVENT_TYPES)[number]
export type EventSource = (typeof EVENT_SOURCES)[number]

const PassThroughPayload = z.record(z.string(), z.unknown()).default({})

const SpendPayload = z.object({
  amount: z.number().nonnegative(),
  currency: z.string().min(1).max(8),
  vendor: z.string().optional(),
  category: z.string().optional(),
  note: z.string().optional(),
}).passthrough()

const MetricPayload = z.object({
  name: z.string().min(1),
  value: z.union([z.number(), z.string(), z.boolean()]),
  unit: z.string().optional(),
}).passthrough()

const GithubCommitPayload = z.object({
  sha: z.string().min(7),
  additions: z.number().int().optional(),
  deletions: z.number().int().optional(),
  url: z.string().url().optional(),
}).passthrough()

const baseFields = {
  project: z.string().min(1).max(120),
  summary: z.string().min(1).max(500),
  source: z.enum(EVENT_SOURCES).default('manual'),
  // Optional. When set, the event lands with this timestamp (e.g. github_commit
  // events use the actual commit time so old projects don't look "thriving"
  // just because we ingested them today). Defaults to DB now() if omitted.
  ts: z.string().datetime().optional(),
}

export const IngestBody = z.discriminatedUnion('type', [
  z.object({ ...baseFields, type: z.literal('spend'),         payload: SpendPayload }),
  z.object({ ...baseFields, type: z.literal('metric'),        payload: MetricPayload }),
  z.object({ ...baseFields, type: z.literal('github_commit'), payload: GithubCommitPayload }),
  z.object({ ...baseFields, type: z.literal('progress'),      payload: PassThroughPayload }),
  z.object({ ...baseFields, type: z.literal('decision'),      payload: PassThroughPayload }),
  z.object({ ...baseFields, type: z.literal('blocker'),       payload: PassThroughPayload }),
  z.object({ ...baseFields, type: z.literal('next_step'),     payload: PassThroughPayload }),
  z.object({ ...baseFields, type: z.literal('milestone'),     payload: PassThroughPayload }),
  z.object({ ...baseFields, type: z.literal('status_change'), payload: PassThroughPayload }),
  z.object({ ...baseFields, type: z.literal('github_deploy'), payload: PassThroughPayload }),
  z.object({ ...baseFields, type: z.literal('note'),          payload: PassThroughPayload }),
])

export type IngestInput = z.infer<typeof IngestBody>

// --- Read-side row shapes (mirror the SQL views and tables) ---

export type ProjectStatus = 'seedling' | 'thriving' | 'active' | 'dormant'

export const PROJECT_STAGES = ['idea', 'wip', 'shipped', 'archived'] as const
export type ProjectStage = (typeof PROJECT_STAGES)[number]

export interface ProjectStateRow {
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
}

export interface EventRow {
  id: string
  project_id: string
  ts: string
  type: EventType
  summary: string
  payload: Record<string, unknown>
  source: EventSource
}

export interface ProjectMetricRow {
  project_id: string
  name: string
  value: unknown
  unit: string | null
  as_of: string
}

// --- Owner-side mutations on the projects table (NOT events; events are append-only) ---

export const ProjectCreate = z.object({
  slug: z.string().min(1).max(60).regex(/^[a-z0-9-]+$/, 'lowercase, digits, hyphens only'),
  name: z.string().min(1).max(120),
  category: z.string().min(1).max(40).default('other'),
  goal: z.string().max(2000).optional(),
  repo: z.string().max(120).optional(),
  live_url: z.string().url().optional(),
  tech_stack: z.array(z.string().min(1).max(40)).max(20).default([]),
  stage: z.enum(PROJECT_STAGES).optional(),
  manual_position: z.object({ x: z.number(), y: z.number() }).nullable().optional(),
})

export const ProjectPatch = ProjectCreate
  .partial()
  .omit({ slug: true })
  .extend({
    archived: z.boolean().optional(),
    // Owner-only soft-remove: drops the tower from the world without touching
    // its events. See migration 20260607.
    hidden: z.boolean().optional(),
  })

export type ProjectCreateInput = z.infer<typeof ProjectCreate>
export type ProjectPatchInput = z.infer<typeof ProjectPatch>
