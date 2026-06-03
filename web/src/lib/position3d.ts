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

/**
 * Collision relaxation — nudges overlapping spires apart so a crowded world
 * keeps at least a small gap between buildings. Distance-from-centre (recency)
 * is only perturbed locally where things actually overlap, so the overall
 * "recent = near" reading survives.
 *
 * Deterministic (no randomness) so the layout is stable between renders. O(N²)
 * per iteration, but N is small and this only runs when the project set or
 * the as-of time changes — not per frame.
 */
export interface Placeable {
  x: number
  z: number
  /** Half-width of the building's footprint (plinth radius). */
  footprint: number
  /** Manually-placed projects are anchors — never moved, only avoided. */
  fixed?: boolean
}

export function relaxPositions<T extends Placeable>(items: T[], gap = 0.7, iterations = 18): T[] {
  const pts = items.map((i) => ({ ...i }))
  for (let it = 0; it < iterations; it++) {
    for (let a = 0; a < pts.length; a++) {
      for (let b = a + 1; b < pts.length; b++) {
        const A = pts[a]!, B = pts[b]!
        let dx = B.x - A.x, dz = B.z - A.z
        let d = Math.hypot(dx, dz)
        const minD = A.footprint + B.footprint + gap
        if (d >= minD) continue
        if (d < 1e-4) {
          // Coincident — separate along a deterministic golden-angle bearing.
          const ang = a * 2.399963229
          dx = Math.cos(ang); dz = Math.sin(ang); d = 1
        }
        const overlap = minD - d
        const ux = dx / d, uz = dz / d
        if (A.fixed && B.fixed) continue
        if (A.fixed) { B.x += ux * overlap; B.z += uz * overlap }
        else if (B.fixed) { A.x -= ux * overlap; A.z -= uz * overlap }
        else {
          A.x -= ux * overlap * 0.5; A.z -= uz * overlap * 0.5
          B.x += ux * overlap * 0.5; B.z += uz * overlap * 0.5
        }
      }
    }
  }
  return pts
}
