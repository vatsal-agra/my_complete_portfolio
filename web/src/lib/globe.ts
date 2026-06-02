/**
 * Globe geometry — the world is no longer flat.
 *
 * The ground is the top hemisphere of a sphere of radius GLOBE_R, centered
 * at (0, -GLOBE_R, 0). That puts the north pole at world origin (0, 0, 0),
 * which is where everything used to be — so existing (x, z) project
 * positions still feel natural, they just sit a bit lower as r grows.
 *
 *   Y_surface(r) = -GLOBE_R + sqrt(GLOBE_R² - r²)
 *
 * Examples (R = 60):
 *   r = 0   → Y =  0.00   (north pole)
 *   r = 10  → Y = -0.84
 *   r = 20  → Y = -3.43
 *   r = 28  → Y = -6.93   (farthest active projects)
 *   r = 50  → Y = -26.79  (well below the camera)
 *
 * Spires stay vertical (no surface-normal tilt) — this gives a "planet of
 * cities" feel without making the world hard to navigate.
 */
export const GLOBE_R = 60
export const GLOBE_CENTER_Y = -GLOBE_R

/** Ground colour — light lunar-regolith grey (real moon surface is a fairly
 *  light warm grey, NOT dark slate). Kept here so Scene3D's surface and the
 *  per-spire erosion patches in House3D stay in sync. */
export const FLOOR_COLOR = '#c4c2bd'

export function groundYAt(x: number, z: number): number {
  const r2 = x * x + z * z
  const limit = GLOBE_R * GLOBE_R
  if (r2 >= limit) return GLOBE_CENTER_Y  // beyond the horizon — clamp
  return GLOBE_CENTER_Y + Math.sqrt(limit - r2)
}
