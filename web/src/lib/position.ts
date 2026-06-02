import type { ProjectState, ProjectStatus } from './types'

// Base radius (px) by status — active near the center, dormant out at the edges.
const STATUS_BASE_RADIUS: Record<ProjectStatus, number> = {
  thriving: 80,
  active: 200,
  seedling: 260,
  dormant: 380,
}

// Extra drift per day-since-last-activity. Tuned to feel like neglected projects
// gently slide outward over weeks, not jarringly within hours.
const DAY_DRIFT_PX = 6

// Deterministic angle from slug hash so the same project always lands at the
// same compass bearing even if other projects come and go.
// FNV-1a 32-bit + extra avalanche so similar slugs (e.g. "pipeline" vs
// "verify-1780237522161") don't collapse to nearby angles.
function hash32(s: string, salt = 0): number {
  let h = (216636261 ^ salt) >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  h = Math.imul(h ^ (h >>> 16), 0x85EBCA6B)
  h ^= h >>> 13
  h = Math.imul(h, 0xC2B2AE35)
  h ^= h >>> 16
  return h >>> 0
}

function hashAngle(slug: string): number {
  return (hash32(slug, 1) / 0xffffffff) * Math.PI * 2
}

function radiusJitter(slug: string): number {
  // ±30px so identical-angle collisions still separate radially
  return (hash32(slug, 2) / 0xffffffff) * 60 - 30
}

function daysSince(ts: string | null, fallback: string): number {
  const t = ts ? Date.parse(ts) : Date.parse(fallback)
  if (Number.isNaN(t)) return 0
  return Math.max(0, (Date.now() - t) / (1000 * 60 * 60 * 24))
}

export function computePosition(p: ProjectState): { x: number; y: number } {
  if (p.manual_position) return p.manual_position
  const angle = hashAngle(p.slug)
  const baseR = STATUS_BASE_RADIUS[p.status] ?? 220
  const drift = daysSince(p.last_activity_ts, p.created_at) * DAY_DRIFT_PX
  const r = Math.max(40, baseR + drift + radiusJitter(p.slug))
  return { x: Math.cos(angle) * r, y: Math.sin(angle) * r }
}
