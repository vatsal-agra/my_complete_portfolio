/**
 * Spire dimensions, decoupled from status (PROJECT_WORLD turn 2024+ —
 * distance and height now encode different signals).
 *
 *   distance from center  ← how recently the project was touched
 *   height of the spire   ← how BIG the project is (lines of code in the repo)
 *   status (color, glow)  ← visual flair only
 */

/**
 * Per-project signals at a given point in time, used by the height calc.
 */
export interface ProjectActivity {
  commits: number
  totalEvents: number
  /** Total bytes of code in the repo (sum of GitHub language byte counts).
   *  When present this drives height — a huge codebase is tall even if it was
   *  only committed twice. Recorded by the GitHub sync as a code_bytes metric. */
  codeBytes?: number
}

/**
 * Spire height in world units.
 *
 * PRIMARY signal is code size (bytes of source across all languages ≈ how much
 * code actually lives in the repo). Log-scaled so a 10 MB monolith doesn't
 * dwarf everything, but a big codebase clearly towers over a tiny one:
 * - ~5 KB    → ~2.0u
 * - ~50 KB   → ~3.7u
 * - ~500 KB  → ~5.4u
 * - ~5 MB    → ~7.1u
 * - ~50 MB+  → ~8.8u (clamped at 9.8 so giants don't break the camera)
 *
 * Fallback (no code size yet — e.g. a manual project with no repo, or before
 * the first GitHub sync records it): the old commit/event-count curve, so the
 * spire still reflects *some* activity instead of collapsing to the floor.
 */
export function computeHeight(activity: ProjectActivity): number {
  const { commits, totalEvents, codeBytes } = activity

  if (codeBytes && codeBytes > 0) {
    const h = 1.25 + (Math.log10(codeBytes) - 3) * 1.7
    return Math.max(1.2, Math.min(9.8, h))
  }

  const effective = commits > 0 ? commits : totalEvents
  if (effective === 0) return 1.10
  return 1.25 + Math.min(8.55, Math.sqrt(effective) * 1.00)
}

/**
 * Spire base + top radii scaled gently with height so taller spires don't
 * look like spaghetti. Returns the values [House3D.tsx](web/src/components/House3D.tsx)
 * needs to draw the geometry.
 */
export function spireRadii(height: number): {
  bottomRadius: number
  topRadius: number
  capRadius: number
} {
  // 0.7u tall   → base 0.22, top 0.17, cap 0.21
  // 3.2u tall   → base 0.30, top 0.21, cap 0.27
  // 6.3u tall   → base 0.38, top 0.25, cap 0.33
  const t = Math.min(1, (height - 0.7) / 5.6)
  return {
    bottomRadius: 0.22 + t * 0.16,
    topRadius:    0.17 + t * 0.08,
    capRadius:    0.21 + t * 0.12,
  }
}
