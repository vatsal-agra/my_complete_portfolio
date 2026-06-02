/**
 * Client-side state derivation for time-travel (PROJECT_SPEC §10).
 *
 * Given the full event stream + the projects' static metadata, compute what
 * project_state would have returned at timestamp T (`asOf`).
 *
 * "Did this project exist yet?" is decided by the project's **effective
 * birth** = min(earliest event ts, projects.created_at), NOT just created_at.
 * Reason: when we auto-imported repos from GitHub, `created_at` is the day we
 * ran the import, but the project's real history goes back to its first
 * commit. Without this, scrubbing past the import date wipes everything.
 */
import type { ProjectEvent, ProjectState, ProjectStatus } from './types'

const DAY_MS = 86_400_000

/** Earliest event timestamp per project_id (undefined if project has no events). */
function indexEarliestEvents(events: ProjectEvent[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const e of events) {
    const t = Date.parse(e.ts)
    const prev = m.get(e.project_id)
    if (prev === undefined || t < prev) m.set(e.project_id, t)
  }
  return m
}

/** A project's effective birth — earliest of (earliest event, created_at). */
export function effectiveBirth(p: ProjectState, earliestEvents: Map<string, number>): number {
  const created = Date.parse(p.created_at)
  const ee = earliestEvents.get(p.id)
  return ee !== undefined ? Math.min(ee, created) : created
}

/** Earliest moment in the ecosystem — used as the scrubber's left bound. */
export function ecosystemStart(projects: ProjectState[], events: ProjectEvent[]): number {
  if (projects.length === 0) return Date.now() - 30 * DAY_MS
  const earliestEvents = indexEarliestEvents(events)
  let earliest = Infinity
  for (const p of projects) {
    const t = effectiveBirth(p, earliestEvents)
    if (t < earliest) earliest = t
  }
  return Number.isFinite(earliest) ? earliest : Date.now() - 30 * DAY_MS
}

export function deriveProjectsAt(
  liveProjects: ProjectState[],
  events: ProjectEvent[],
  asOf: number,
): ProjectState[] {
  const earliestEvents = indexEarliestEvents(events)

  // Bucket events by project_id, only those at-or-before asOf.
  const byProject = new Map<string, ProjectEvent[]>()
  for (const e of events) {
    if (Date.parse(e.ts) > asOf) continue
    let bucket = byProject.get(e.project_id)
    if (!bucket) { bucket = []; byProject.set(e.project_id, bucket) }
    bucket.push(e)
  }

  const out: ProjectState[] = []
  for (const p of liveProjects) {
    const birth = effectiveBirth(p, earliestEvents)
    if (birth > asOf) continue  // hadn't started existing yet

    const pEvents = byProject.get(p.id) ?? []
    pEvents.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))

    const lastActivity = pEvents.length > 0
      ? Date.parse(pEvents[pEvents.length - 1]!.ts)
      : birth  // no events yet → activity dates from birth, not from now()
    let lastNonManual: number | null = null
    let nextStep: string | null = null
    let commits30d = 0

    for (const e of pEvents) {
      const t = Date.parse(e.ts)
      if (e.source !== 'manual') lastNonManual = t
      if (e.type === 'next_step') nextStep = e.summary
      if (e.type === 'github_commit' && t > asOf - 30 * DAY_MS) commits30d++
    }

    out.push({
      ...p,
      last_activity_ts: new Date(lastActivity).toISOString(),
      status: computeStatus(p.repo, birth, lastActivity, lastNonManual, asOf),
      next_step: nextStep,
      commits_30d: commits30d,
    })
  }
  return out
}

function computeStatus(
  repo: string | null,
  birth: number,
  lastActivity: number,
  lastNonManual: number | null,
  asOf: number,
): ProjectStatus {
  if (repo === null) return 'seedling'
  if (lastNonManual === null && (asOf - birth) < 3 * DAY_MS) return 'seedling'
  const since = asOf - lastActivity
  if (since < 7 * DAY_MS)  return 'thriving'
  if (since < 14 * DAY_MS) return 'active'
  return 'dormant'
}
