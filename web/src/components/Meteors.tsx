/**
 * Meteors — when a project's activity advances (a commit/release lands via
 * GitHub pull or an MCP push), a meteor streaks out of deep space and slams
 * into that spire, which then pulses (House3D `fresh`). Turns the world into a
 * live activity feed you can feel.
 *
 * Each meteor is spawned by World3D (keyed to a slug) and self-animates from a
 * randomised high origin down to the spire cap over ~1.3s, accelerating as it
 * falls, with a tapered glowing trail. World3D prunes them on a timer.
 */
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { groundYAt } from '../lib/globe'

const BASE_HEIGHT = 0.16  // keep in sync with House3D
const DURATION = 2.6      // seconds, sky → impact (slower, more graceful fall)

export interface MeteorSpec {
  id: number
  slug: string
  color: string
}

interface Entry { slug: string; x: number; z: number; height: number }

function Meteor({ target, color }: { target: THREE.Vector3; color: string }) {
  const groupRef = useRef<THREE.Group>(null)
  const headRef = useRef<THREE.Mesh>(null)
  const trailRef = useRef<THREE.Mesh>(null)
  const t0 = useRef<number | null>(null)

  // Randomised origin high above, offset to one side so it arcs in at an angle.
  const start = useMemo(() => {
    const a = Math.random() * Math.PI * 2
    const spread = 12 + Math.random() * 10
    return new THREE.Vector3(
      target.x + Math.cos(a) * spread,
      target.y + 34 + Math.random() * 12,
      target.z + Math.sin(a) * spread,
    )
  }, [target])

  const pos = useMemo(() => new THREE.Vector3(), [])

  useFrame((state) => {
    if (t0.current === null) t0.current = state.clock.elapsedTime
    const p = Math.min(1, (state.clock.elapsedTime - t0.current) / DURATION)
    const eased = p * p  // accelerate as it falls
    pos.copy(start).lerp(target, eased)

    const g = groupRef.current
    if (g) {
      g.position.copy(pos)
      g.lookAt(start)  // local +Z points back along the trail
    }
    // Fade the trail out in the last 25% so the impact reads as a flash, then
    // the spire's own `fresh` pulse takes over.
    const fade = p < 0.75 ? 1 : 1 - (p - 0.75) / 0.25
    if (headRef.current) (headRef.current.material as THREE.MeshBasicMaterial).opacity = fade
    if (trailRef.current) (trailRef.current.material as THREE.MeshBasicMaterial).opacity = 0.5 * fade
  })

  return (
    <group ref={groupRef}>
      {/* glowing head */}
      <mesh ref={headRef}>
        <sphereGeometry args={[0.32, 12, 12]} />
        <meshBasicMaterial color="#fff4d6" transparent depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      {/* tapered trail extending back toward the origin (local +Z) */}
      <mesh ref={trailRef} position={[0, 0, 2.6]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.02, 0.22, 5.2, 10, 1, true]} />
        <meshBasicMaterial color={color} transparent opacity={0.5} depthWrite={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}

export function Meteors({ meteors, entries }: { meteors: MeteorSpec[]; entries: Entry[] }) {
  const byslug = useMemo(() => {
    const m = new Map<string, Entry>()
    for (const e of entries) m.set(e.slug, e)
    return m
  }, [entries])

  return (
    <>
      {meteors.map((mt) => {
        const e = byslug.get(mt.slug)
        if (!e) return null
        const top = groundYAt(e.x, e.z) + BASE_HEIGHT + e.height + 0.6
        const target = new THREE.Vector3(e.x, top, e.z)
        return <Meteor key={mt.id} target={target} color={mt.color} />
      })}
    </>
  )
}
