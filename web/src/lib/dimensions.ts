/**
 * Spire dimensions, decoupled from status (PROJECT_WORLD turn 2024+ —
 * distance and height now encode different signals).
 *
 *   distance from center  ← how recently the project was touched
 *   height of the spire   ← how big the project is (commits / events)
 *   status (color, glow)  ← visual flair only
 */

/**
 * Per-project commit count (and total event count) at a given point in time.
 * Used by both the height calculation and the position calculation.
 */
export interface ProjectActivity {
  commits: number
  totalEvents: number
}

/**
 * Spire height in world units. Sqrt-curve growth so adding the 11th commit
 * has a smaller visible effect than adding the 2nd — but every commit count
 * lands on a unique height (no buckets, no rounding).
 *
 * Overall scale bumped ~1.55× so the world reads as a real skyline:
 * - 0 events  → 1.10u   (just-imported baseline)
 * - 1 event   → 2.25u
 * - 7 commits → 3.94u
 * - 14 commits→ 5.01u
 * - 30 commits→ 6.75u
 * - 100+      → ~9.8u   (clamped so giant repos don't break the camera)
 *
 * Commits are the primary signal; for projects without a GitHub repo, total
 * event count is the fallback so an algoviz with 5 manual updates is still
 * visibly bigger than an algoviz with 0.
 */
export function computeHeight(activity: ProjectActivity): number {
  const { commits, totalEvents } = activity
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
