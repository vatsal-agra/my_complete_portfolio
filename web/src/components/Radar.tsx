/**
 * Radar — bottom-left minimap + compass in one.
 *
 *  - Top-down dots for every project, positioned by world (x, z) and coloured
 *    by their category territory.
 *  - N/E/S/W cardinal ticks so the world has a fixed orientation.
 *  - A live marker on the rim showing where the camera is, with a line to
 *    centre — rotates as you orbit (updated via rAF, no React churn).
 *  - Click a dot to fly the camera to that project.
 */
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { STAGE_COLOR } from './House3D'
import type { ProjectStage } from '../lib/types'

export interface RadarItem {
  slug: string
  name: string
  x: number
  z: number
  stage: ProjectStage
}

const SIZE = 150
const C = SIZE / 2
const RADAR_R = 62
const WORLD_R = 30          // world units mapped to the radar edge
const SCALE = RADAR_R / WORLD_R

function clampToRadar(x: number, y: number): [number, number] {
  const d = Math.hypot(x, y)
  if (d <= RADAR_R) return [C + x, C + y]
  const k = RADAR_R / d
  return [C + x * k, C + y * k]
}

export function Radar({
  items,
  controlsRef,
  onFocus,
  matchSlugs,
}: {
  items: RadarItem[]
  controlsRef: React.MutableRefObject<any>
  onFocus: (slug: string) => void
  matchSlugs: Set<string> | null
}) {
  const camDotRef = useRef<SVGCircleElement>(null)
  const camLineRef = useRef<SVGLineElement>(null)

  // Animate the camera marker from the live camera position each frame.
  useEffect(() => {
    let raf = 0
    const tick = () => {
      const controls = controlsRef.current
      const cam = controls?.object as THREE.Camera | undefined
      if (cam) {
        const [px, py] = clampToRadar(cam.position.x * SCALE, cam.position.z * SCALE)
        camDotRef.current?.setAttribute('cx', String(px))
        camDotRef.current?.setAttribute('cy', String(py))
        camLineRef.current?.setAttribute('x1', String(px))
        camLineRef.current?.setAttribute('y1', String(py))
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [controlsRef])

  const searching = matchSlugs !== null

  return (
    <div className="radar">
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        {/* dish */}
        <circle cx={C} cy={C} r={RADAR_R} className="radar-dish" />
        <circle cx={C} cy={C} r={RADAR_R * 0.6} className="radar-ring" />
        <circle cx={C} cy={C} r={RADAR_R * 0.3} className="radar-ring" />
        <line x1={C} y1={C - RADAR_R} x2={C} y2={C + RADAR_R} className="radar-cross" />
        <line x1={C - RADAR_R} y1={C} x2={C + RADAR_R} y2={C} className="radar-cross" />

        {/* cardinal labels */}
        <text x={C} y={C - RADAR_R + 11} className="radar-card">N</text>
        <text x={C + RADAR_R - 6} y={C + 4} className="radar-card">E</text>
        <text x={C} y={C + RADAR_R - 3} className="radar-card">S</text>
        <text x={C - RADAR_R + 6} y={C + 4} className="radar-card">W</text>

        {/* camera direction: rim marker + line to centre */}
        <line ref={camLineRef} x1={C} y1={C - RADAR_R} x2={C} y2={C} className="radar-cam-line" />
        <circle ref={camDotRef} cx={C} cy={C - RADAR_R} r={3.2} className="radar-cam" />

        {/* project dots */}
        {items.map((it) => {
          const [dx, dy] = clampToRadar(it.x * SCALE, it.z * SCALE)
          const dim = searching && !matchSlugs!.has(it.slug)
          return (
            <circle
              key={it.slug}
              cx={dx}
              cy={dy}
              r={dim ? 1.8 : 2.8}
              fill={STAGE_COLOR[it.stage] ?? STAGE_COLOR.wip}
              opacity={dim ? 0.25 : 1}
              className="radar-dot"
              onClick={() => onFocus(it.slug)}
            >
              <title>{it.name}</title>
            </circle>
          )
        })}
      </svg>
    </div>
  )
}
