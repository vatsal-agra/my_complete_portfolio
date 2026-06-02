/**
 * 3D world positioning — **distance encodes recency, not status**.
 *
 * The closer a project is to center, the more recently it was touched.
 * The longer it's been silent, the further it drifts. Status (thriving /
 * active / dormant / seedling) is no longer used for radius — it only
 * affects the spire's *appearance* now (color, glow, beam).
 *
 * The angle remains a deterministic slug-hash so a project always lives
 * on the same compass bearing — it just slides in or out radially as its
 * activity shifts.
 */
import type { ProjectState } from './types'
import { angleInRegion, type Region } from './regions'

const DAY_MS = 86_400_000

/** Minimum radius — even a project touched 'now' is 4u from center. */
const R_MIN = 4
/** Hard clamp so 5-year-dormant projects don't go off-screen. */
const R_MAX = 28
/** Sqrt-curve steepness. Smaller = wider spread across the recent week. */
const R_FACTOR = 2.4
/** ±jitter so two equally-recent projects don't sit at identical radii. */
const RADIAL_JITTER = 0.9

function hash32(s: string, salt = 0): number {
  let h = (2166136261 ^ salt) >>> 0
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

/**
 * Compute world XZ for a project. `asOf` is the timestamp the world is being
 * rendered AT — defaults to now, but the scrubber passes a past timestamp so
 * "days since last activity" is correct relative to that moment.
 */
export function position3DFor(
  p: ProjectState,
  asOf: number = Date.now(),
  region?: Region,
): { x: number; z: number } {
  if (p.manual_position) {
    // Manual positions came from the old 2D coord system — pixel scale.
    return { x: p.manual_position.x * 0.022, z: p.manual_position.y * 0.022 }
  }

  // Bearing comes from the project's territory wedge when regions are active,
  // so same-category projects cluster. Falls back to a stable slug-hash bearing
  // when no region is supplied (keeps old behaviour for callers that don't pass one).
  const angle = region
    ? angleInRegion(p.slug, region)
    : (hash32(p.slug, 1) / 0xffffffff) * Math.PI * 2

  const lastTs = p.last_activity_ts
    ? Date.parse(p.last_activity_ts)
    : Date.parse(p.created_at)
  const daysSince = Number.isFinite(lastTs)
    ? Math.max(0, (asOf - lastTs) / DAY_MS)
    : 0

  const radius = R_MIN + Math.min(R_MAX - R_MIN, Math.sqrt(daysSince) * R_FACTOR)
  const jitter = ((hash32(p.slug, 2) / 0xffffffff) - 0.5) * RADIAL_JITTER * 2

  return {
    x: Math.cos(angle) * (radius + jitter),
    z: Math.sin(angle) * (radius + jitter),
  }
}

export { R_MIN, R_MAX }
