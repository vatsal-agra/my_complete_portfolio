/**
 * Adapt the sanitized /public/* shapes to the owner-side shapes so the SAME
 * components (House3D, Ecosystem) render the public world identically — just
 * with owner-only data (spend, metrics, manual position) blanked out.
 */
import type {
  ProjectState, ProjectDetail, ProjectEvent,
  PublicProjectState, PublicProjectDetail,
} from './types'

export function publicStateToProjectState(p: PublicProjectState): ProjectState {
  return {
    id: p.slug,
    slug: p.slug,
    name: p.name,
    category: p.category,
    goal: p.goal,
    repo: p.repo,
    live_url: p.live_url,
    tech_stack: p.tech_stack,
    stage: p.stage,
    manual_position: null,
    created_at: p.created_at,
    last_activity_ts: p.last_activity_ts,
    status: p.status,
    next_step: null,
    commits_30d: p.commits_30d,
    code_bytes: p.code_bytes,
  }
}

export function publicDetailToProjectDetail(d: PublicProjectDetail): ProjectDetail {
  return {
    project: publicStateToProjectState(d.project),
    events: d.events.map((e): ProjectEvent => ({
      id: e.id,
      project_id: '',
      ts: e.ts,
      type: e.type,
      summary: e.summary,
      payload: {},
      source: 'github',
    })),
    metrics: [],            // never exposed publicly
    current_state: null,
    spend_summary: { by_currency: {}, by_category: {}, by_vendor: {}, total_events: 0 },
  }
}
