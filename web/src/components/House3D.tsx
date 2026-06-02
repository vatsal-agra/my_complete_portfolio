/**
 * House3D — each project is a slender stone obelisk.
 *
 * Three independent visual axes:
 *   - HEIGHT  → commit / event volume (computed in World3D)
 *   - HUE     → lifecycle STAGE (idea / wip / shipped / archived)  ← this file
 *   - GLOW    → STATUS (recency: thriving / active / seedling / dormant)
 *
 * Stage drives the spire's identity colour. Status drives the "is this alive
 * right now?" flair: cap emissive intensity, halo aura, beam of light into
 * the sky, sparkles, and the "light gone out" dim look for dormant.
 *
 * Spire radii scale gently with height so a 6u-tall obelisk doesn't look like
 * a piece of spaghetti and a 0.7u one doesn't look like a hockey puck.
 */
import { useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html, Sparkles, useTexture } from '@react-three/drei'
import * as THREE from 'three'
import { spireRadii } from '../lib/dimensions'
import { groundYAt, GLOBE_R, GLOBE_CENTER_Y } from '../lib/globe'
import type { ProjectState, ProjectStage } from '../lib/types'

/** Lifecycle hue palette — warm cosmic theme, deliberately no purple. */
const STAGE_COLOR: Record<ProjectStage, string> = {
  idea:     '#7dd3fc',  // pale sky blue — spark of a concept
  wip:      '#f97316',  // bright dark orange — active forge
  shipped:  '#34d399',  // vibrant emerald — live in the wild
  archived: '#94a3b8',  // dim slate — memory
}

/** Recency tint, kept for the side panel's status pill colours. */
const STATUS_COLOR: Record<ProjectState['status'], string> = {
  thriving: '#34d399',
  active:   '#86efac',
  seedling: '#fb923c',
  dormant:  '#94a3b8',
}

interface StatusVisuals {
  capEmissiveIntensity: number
  beam: boolean
  beamHeight: number
  sparkles: boolean
  haloAura: boolean
}

const STATUS_VISUALS: Record<ProjectState['status'], StatusVisuals> = {
  thriving: { capEmissiveIntensity: 2.4, beam: true,  beamHeight: 13, sparkles: true,  haloAura: true  },
  active:   { capEmissiveIntensity: 1.6, beam: true,  beamHeight: 7,  sparkles: false, haloAura: true  },
  seedling: { capEmissiveIntensity: 1.4, beam: false, beamHeight: 0,  sparkles: false, haloAura: false },
  dormant:  { capEmissiveIntensity: 0.5, beam: false, beamHeight: 0,  sparkles: false, haloAura: false },
}

const BASE_HEIGHT = 0.16  // depth of the stone base disc beneath every pillar

interface Props {
  project: ProjectState
  x: number
  z: number
  /** Pillar height above the base disc, computed by World3D from commits/events. */
  height: number
  selected: boolean
  anyInterior: boolean
  fresh: boolean
  /** True when a search is active and this spire is NOT a match (dim it hard). */
  searchMiss?: boolean
  /** True when a search is active and this spire IS a match (light it up). */
  searchHit?: boolean
  onClick: (slug: string) => void
}

export function House3D({ project, x, z, height, selected, anyInterior, fresh, searchMiss = false, searchHit = false, onClick }: Props) {
  const visuals = STATUS_VISUALS[project.status]
  // Stage drives hue. Fall back to wip if a legacy row somehow has no stage
  // (e.g. before the migration is applied) so we never paint with undefined.
  const color = STAGE_COLOR[project.stage] ?? STAGE_COLOR.wip
  // A search miss dims a spire just like an interior-open mute, but harder.
  const muted = (anyInterior && !selected) || searchMiss
  const [hovered, setHovered] = useState(false)

  const radii = useMemo(() => spireRadii(height), [height])
  const baseRadius = radii.bottomRadius * 1.6  // wider plinth beneath the pillar
  const capRadius = radii.capRadius

  // Same cached moon texture the hemisphere uses (Scene3D configures its
  // wrap/repeat/offset on the shared instance). The erosion patch samples it
  // with matching equirectangular UVs so it reads as the real ground, not a
  // flat grey ring.
  const moon = useTexture('/textures/moon_color.jpg')

  const capRef = useRef<THREE.Mesh>(null)
  const haloRef = useRef<THREE.Mesh>(null)
  const beamRef = useRef<THREE.Mesh>(null)
  const ringRef = useRef<THREE.Mesh>(null)

  // Stable per-spire phase so neighbouring obelisks don't breathe in lockstep.
  const phase = useMemo(() => {
    let h = 0
    for (const c of project.slug) h = (h * 31 + c.charCodeAt(0)) & 0xffffffff
    return (h % 1000) / 1000 * Math.PI * 2
  }, [project.slug])

  useFrame((state) => {
    const t = state.clock.elapsedTime + phase

    if (capRef.current) {
      let s = 1
      if (project.status === 'thriving') s = 1 + Math.sin(t * 1.2) * 0.06
      if (project.status === 'active')   s = 1 + Math.sin(t * 0.7) * 0.03
      if (fresh)   s *= 1 + Math.sin(t * 9) * 0.22
      if (hovered) s *= 1.18
      capRef.current.scale.setScalar(s)
    }

    if (haloRef.current && visuals.haloAura) {
      const op = (Math.sin(t * 0.9) * 0.5 + 0.5) * 0.25 + (fresh ? 0.35 : 0.10)
      ;(haloRef.current.material as THREE.MeshBasicMaterial).opacity = op
    }

    if (beamRef.current) {
      // Softer, slower breathe. Settled around 0.22, peaks ~0.30 — distinctly
      // present without commanding the eye away from the spire body.
      const op = (Math.sin(t * 0.5) * 0.06 + 0.24) * (muted ? 0.25 : 1)
      ;(beamRef.current.material as THREE.MeshBasicMaterial).opacity = op
    }

    if (ringRef.current && selected) {
      const s = 1 + Math.sin(t * 1.6) * 0.06
      ringRef.current.scale.setScalar(s)
    }
  })

  // Search misses fade harder than a normal mute so matches really pop.
  const opacity = searchMiss ? 0.12 : (muted ? 0.35 : 1)
  const pillarMid = BASE_HEIGHT + height / 2
  const capY = BASE_HEIGHT + height + capRadius * 0.6
  const beamY = capY + visuals.beamHeight / 2 + 0.4

  // The world is a globe now. Drop the whole spire group to the curved
  // surface at (x, z) so the base sits on the ground instead of floating.
  const surfaceY = useMemo(() => groundYAt(x, z), [x, z])

  // Deterministic "emerged from the ground" crack pattern around the base —
  // each crack is a line segment (length, width, angle) that we use BOTH for
  // its position and for actually displacing the ground geometry into a
  // groove. Stable per project so it doesn't shimmer between frames.
  const cracks = useMemo(() => {
    let h = 0
    for (const c of project.slug) h = (h * 31 + c.charCodeAt(0)) & 0xffffffff
    const rng = () => {
      h = ((h * 1103515245) + 12345) & 0xffffffff
      return ((h >>> 0) % 100000) / 100000
    }
    const n = 7 + Math.floor(rng() * 4)
    const baseEdge = baseRadius * 1.08
    type Crack = { angle: number; len: number; width: number; depth: number; ax: number; az: number; bx: number; bz: number }
    const arr: Crack[] = []
    for (let i = 0; i < n; i++) {
      const angle = (i / n) * Math.PI * 2 + (rng() - 0.5) * 0.55
      const len   = 0.9 + rng() * 1.4
      const width = 0.10 + rng() * 0.10
      const depth = 0.16 + rng() * 0.12
      const dx = Math.cos(angle)
      const dz = Math.sin(angle)
      arr.push({
        angle, len, width, depth,
        ax: baseEdge * dx,
        az: baseEdge * dz,
        bx: (baseEdge + len) * dx,
        bz: (baseEdge + len) * dz,
      })
    }
    return arr
  }, [project.slug, baseRadius])

  // Eroded ground patch — a custom RingGeometry around the base whose
  // vertices get pushed DOWN along each crack line, producing real grooves
  // that respond to lighting and shadow. The patch's underlying curvature
  // matches the globe so it sits flush with the sphere skin around it.
  const erosionGeometry = useMemo(() => {
    const innerR = baseRadius * 1.0
    const outerR = baseRadius * 3.4
    const tSegs = 128  // around the ring
    const pSegs = 22   // radial — enough vertices for crack grooves to read
    const geo = new THREE.RingGeometry(innerR, outerR, tSegs, pSegs)
    geo.rotateX(-Math.PI / 2)  // lay flat in XZ

    const pos = geo.attributes.position!.array as Float32Array
    const uv = geo.attributes.uv!.array as Float32Array
    // Equirect UV at the patch centre, used to unwrap the longitude seam so a
    // patch never straddles the φ=±π discontinuity.
    const u0 = Math.atan2(z, -x) / (Math.PI * 2)
    for (let i = 0, j = 0; i < pos.length; i += 3, j += 2) {
      const lx = pos[i]!
      const lz = pos[i + 2]!
      const wx = x + lx
      const wz = z + lz
      // Base Y follows the local sphere curvature so the patch is flush with
      // the globe surface where there's no crack.
      const baseY = groundYAt(wx, wz) - surfaceY

      // Match Scene3D's hemisphere mapping exactly: longitude → u, polar angle
      // → v (geometry convention 1 - θ/θLength), so the texture is continuous
      // across the seam between patch and surrounding ground.
      const lyc = groundYAt(wx, wz) - GLOBE_CENTER_Y
      const theta = Math.acos(Math.max(-1, Math.min(1, lyc / GLOBE_R)))
      let u = Math.atan2(wz, -wx) / (Math.PI * 2)
      u = u0 + ((u - u0 + 1.5) % 1 - 0.5)  // unwrap relative to patch centre
      uv[j] = u
      uv[j + 1] = 1 - theta / (Math.PI / 2)

      // Pick the deepest crack at this point.
      let dY = 0
      for (const c of cracks) {
        const abx = c.bx - c.ax
        const abz = c.bz - c.az
        const apx = lx - c.ax
        const apz = lz - c.az
        const ab2 = abx * abx + abz * abz
        const t = Math.max(0, Math.min(1, (apx * abx + apz * abz) / ab2))
        const projX = c.ax + t * abx
        const projZ = c.az + t * abz
        const dxP = lx - projX
        const dzP = lz - projZ
        const dist = Math.sqrt(dxP * dxP + dzP * dzP)
        const half = c.width * 0.5
        if (dist < half) {
          // V-profile across the crack width, tapering shallower toward the
          // far end of the fissure so it looks like it healed outward.
          const across = 1 - dist / half
          const taper  = 0.55 + 0.45 * (1 - t)
          const d = c.depth * across * across * taper
          if (d > dY) dY = d
        }
      }
      pos[i + 1] = baseY - dY
    }
    geo.attributes.position!.needsUpdate = true
    geo.attributes.uv!.needsUpdate = true
    geo.computeVertexNormals()
    return geo
  }, [baseRadius, cracks, x, z, surfaceY])

  return (
    <group
      position={[x, surfaceY, z]}
      onClick={(e) => { e.stopPropagation(); onClick(project.slug) }}
      onPointerOver={(e) => { e.stopPropagation(); setHovered(true); document.body.style.cursor = 'pointer' }}
      onPointerOut={() => { setHovered(false); document.body.style.cursor = '' }}
    >
      {/* Eroded terrain patch — real displaced geometry around the base. The
          ring's vertices are lowered along crack lines, producing genuine
          grooves the directional light shades into shadow. Drawn slightly
          ABOVE the sphere with polygon-offset so the unsplit ground tucks
          underneath cleanly. */}
      <mesh geometry={erosionGeometry} receiveShadow castShadow>
        <meshStandardMaterial
          map={moon}
          bumpMap={moon}
          bumpScale={0.35}
          roughness={0.96}
          metalness={0.0}
          polygonOffset
          polygonOffsetFactor={-1}
          polygonOffsetUnits={-1}
          transparent
          opacity={muted ? 0.7 : 1.0}
        />
      </mesh>

      {/* Base platform — wider stone disc that the obelisk rises out of. */}
      <mesh position={[0, BASE_HEIGHT / 2, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[baseRadius * 0.96, baseRadius, BASE_HEIGHT, 28]} />
        <meshStandardMaterial color="#1a1d2e" roughness={0.55} metalness={0.45} transparent opacity={opacity} />
      </mesh>
      {/* Thin engraved ring around the base, faintly emissive in status color. */}
      <mesh position={[0, BASE_HEIGHT + 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[baseRadius * 0.6, baseRadius * 0.72, 48]} />
        <meshBasicMaterial color={color} transparent opacity={muted ? 0.15 : 0.55} depthWrite={false} />
      </mesh>

      {/* Tapered pillar — stone with subtle emissive seam. */}
      <mesh position={[0, pillarMid, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[radii.topRadius, radii.bottomRadius, height, 18]} />
        <meshStandardMaterial
          color="#252839"
          roughness={0.65}
          metalness={0.32}
          emissive={color}
          emissiveIntensity={muted ? 0.04 : (project.status === 'dormant' ? 0.05 : 0.18)}
          transparent
          opacity={opacity}
        />
      </mesh>

      {/* Vertical light seam running up the pillar (skip for dormant). */}
      {project.status !== 'dormant' && (
        <mesh position={[0, pillarMid, radii.bottomRadius * 0.6]}>
          <boxGeometry args={[0.04, height * 0.86, 0.02]} />
          <meshBasicMaterial color={color} transparent opacity={muted ? 0.25 : 0.8} />
        </mesh>
      )}

      {/* Cap — glowing orb on top, the heart of the project. */}
      <mesh ref={capRef} position={[0, capY, 0]}>
        <icosahedronGeometry args={[capRadius, 1]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={muted ? 0.5 : visuals.capEmissiveIntensity}
          roughness={0.25}
          transparent
          opacity={opacity}
        />
      </mesh>

      {/* Halo aura around the cap. */}
      {(visuals.haloAura || fresh) && (
        <mesh ref={haloRef} position={[0, capY, 0]}>
          <sphereGeometry args={[capRadius * 4.5, 24, 24]} />
          <meshBasicMaterial color={color} transparent opacity={0.18} depthWrite={false} blending={THREE.AdditiveBlending} />
        </mesh>
      )}

      {/* Search hit — light the whole spire up: a bright cap glow + a ground
          ring so matches read instantly against the dimmed misses. */}
      {searchHit && (
        <>
          <mesh position={[0, capY, 0]}>
            <sphereGeometry args={[capRadius * 5.5, 24, 24]} />
            <meshBasicMaterial color={color} transparent opacity={0.3} depthWrite={false} blending={THREE.AdditiveBlending} />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
            <ringGeometry args={[baseRadius * 1.5, baseRadius * 1.9, 64]} />
            <meshBasicMaterial color={color} transparent opacity={0.7} depthWrite={false} blending={THREE.AdditiveBlending} />
          </mesh>
        </>
      )}

      {/* Beam of light reaching up — only living projects emit it. Narrow
          cone that tapers to a near-point so it reads as a thin column of
          light rather than a wide, eye-grabbing flare. */}
      {visuals.beam && !muted && (
        <mesh ref={beamRef} position={[0, beamY, 0]}>
          <cylinderGeometry args={[capRadius * 0.08, capRadius * 0.42, visuals.beamHeight, 16, 1, true]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={0.24}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}

      {/* Sparkles drift around thriving spires — the visual signature of vitality. */}
      {visuals.sparkles && !muted && (
        <Sparkles
          count={28}
          scale={[1.6, height + 1.2, 1.6]}
          position={[0, height / 2 + 0.6, 0]}
          size={2.2}
          speed={0.55}
          color={color}
          opacity={0.85}
        />
      )}

      {/* Selection: animated double ring on the ground. */}
      {selected && (
        <>
          <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
            <ringGeometry args={[baseRadius * 1.8, baseRadius * 2.2, 64]} />
            <meshBasicMaterial color={color} transparent opacity={0.65} depthWrite={false} />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
            <ringGeometry args={[baseRadius * 2.6, baseRadius * 2.75, 64]} />
            <meshBasicMaterial color={color} transparent opacity={0.25} depthWrite={false} />
          </mesh>
        </>
      )}

      {/* Label hovering above. Hidden when this spire is selected — the
          Ecosystem panel already shows the project name in its core. */}
      {!muted && !selected && (
        <Html
          position={[0, capY + capRadius * 1.4, 0]}
          center
          occlude={false}
          style={{ pointerEvents: 'none' }}
        >
          <div className={`house3d-label${hovered ? ' hovered' : ''}`}>
            {project.name}
          </div>
        </Html>
      )}
    </group>
  )
}

export { STATUS_COLOR, STAGE_COLOR }
