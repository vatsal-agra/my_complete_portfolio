/**
 * Scene3D — deep-space sky + photographic lunar ground.
 *
 * Atmosphere: navy/black void overhead with parallaxing star layers, a
 * distant warm-amber galactic core on the horizon, slowly drifting nebula
 * clouds floating high in the sky (NEVER intersecting the ground).
 *
 * Ground: the upper hemisphere of a globe, surfaced with a real photographic
 * moon albedo map (Solar System Scope, CC BY 4.0) reused as a bump map so the
 * directional light carves the craters' relief. Real craters — not painted-on
 * circles — so they read correctly from every angle.
 */
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Stars, Sparkles, useTexture } from '@react-three/drei'
import * as THREE from 'three'
import { GLOBE_R, GLOBE_CENTER_Y } from '../lib/globe'

// Sky colour the fog and background blend to — kept deep navy.
const SKY = '#06060f'

export function Scene3D() {
  const innerStarsRef = useRef<THREE.Group>(null)
  const nebulaRef = useRef<THREE.Group>(null)
  const coreRef = useRef<THREE.Mesh>(null)

  // Real photographic moon surface — equirectangular albedo (2048×1024). The
  // same texture instance is reused as the bump map (shared cache, see
  // useTexture). House3D loads the same cached instance for its erosion
  // patches so they sample identical texels and blend seamlessly.
  const moon = useTexture('/textures/moon_color.jpg')

  useMemo(() => {
    // The hemisphere is a polar cap (thetaLength = π/2): pole → equator. Its
    // UVs span the full 0..1 of the texture vertically, so without correction
    // the whole pole-to-pole map gets squashed into 90° of latitude and
    // craters turn to ovals. Sample only the polar HALF of the map
    // (repeat.y = 0.5, offset.y = 0.5) to keep craters round and correctly
    // scaled. Longitude wraps once around (repeat.x = 1).
    moon.wrapS = THREE.RepeatWrapping
    moon.wrapT = THREE.ClampToEdgeWrapping
    moon.repeat.set(1, 0.5)
    moon.offset.set(0, 0.5)
    moon.anisotropy = 16
    moon.colorSpace = THREE.SRGBColorSpace
    moon.needsUpdate = true
  }, [moon])

  useFrame((state, delta) => {
    if (innerStarsRef.current) innerStarsRef.current.rotation.y += delta * 0.0175
    if (nebulaRef.current) {
      nebulaRef.current.rotation.y -= delta * 0.008
      nebulaRef.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.05) * 0.03
    }
    if (coreRef.current) {
      const s = 1 + Math.sin(state.clock.elapsedTime * 0.18) * 0.04
      coreRef.current.scale.setScalar(s)
    }
  })

  return (
    <>
      <color attach="background" args={[SKY]} />
      {/* Fog uses the sky colour so distance fades INTO the void overhead. */}
      <fog attach="fog" args={[SKY, 32, 110]} />

      {/* Stronger ambient + a warm hemisphere fill so the bright floor can
          bounce light back onto the obelisks (faking GI). */}
      <ambientLight intensity={0.55} color="#dce2f0" />
      <hemisphereLight args={['#b8c4e0', '#fff4dc', 0.7]} />
      <directionalLight
        position={[-14, 22, 10]}
        intensity={1.5}
        color="#e6eeff"
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-30}
        shadow-camera-right={30}
        shadow-camera-top={30}
        shadow-camera-bottom={-30}
        shadow-camera-near={1}
        shadow-camera-far={80}
      />
      {/* Warm rim from the direction of the galactic core. */}
      <pointLight position={[40, 14, -70]} intensity={2.4} color="#ffc885" distance={220} decay={1.6} />

      {/* Galactic core — distant warm glow well above the horizon so it doesn't
          touch the floor. */}
      <mesh ref={coreRef} position={[40, 28, -70]}>
        <sphereGeometry args={[6, 32, 32]} />
        <meshBasicMaterial color="#ffd9a0" transparent opacity={0.55} depthWrite={false} />
      </mesh>
      <mesh position={[40, 28, -70]}>
        <sphereGeometry args={[14, 32, 32]} />
        <meshBasicMaterial color="#ff9b4d" transparent opacity={0.10} depthWrite={false} />
      </mesh>

      {/* Two parallaxing star layers. */}
      <Stars radius={170} depth={70} count={7000} factor={4} fade saturation={0} speed={0.4} />
      <group ref={innerStarsRef}>
        <Stars radius={90} depth={42} count={2800} factor={2.4} fade saturation={0.2} speed={0.8} />
      </group>

      {/* Nebula clouds — pushed FAR back and HIGH so they read as distant
          formations in the upper sky, never crossing the floor plane. */}
      <group ref={nebulaRef}>
        <NebulaPuff position={[ 30, 32, -85]} color="#d97757" opacity={0.16} radius={20} />
        <NebulaPuff position={[-44, 38, -70]} color="#5fb8c4" opacity={0.10} radius={26} />
        <NebulaPuff position={[ 10, 44, -110]} color="#e6b078" opacity={0.10} radius={18} />
        <NebulaPuff position={[-22, 30, -95]} color="#7da3ff" opacity={0.08} radius={22} />
      </group>

      {/* Drifting motes — kept above the ground. */}
      <Sparkles count={140} scale={[70, 22, 70]} position={[0, 12, 0]} size={1.7} speed={0.2} opacity={0.6} color="#fff0c4" />

      {/* The world is a globe — upper hemisphere of a GLOBE_R sphere centered
          below origin, north pole at (0, 0, 0). Surface is a real photographic
          moon albedo, reused as a bump map so light carves crater relief. */}
      <mesh position={[0, GLOBE_CENTER_Y, 0]} receiveShadow>
        <sphereGeometry args={[GLOBE_R, 128, 80, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial
          map={moon}
          bumpMap={moon}
          bumpScale={0.35}
          roughness={0.96}
          metalness={0.0}
          side={THREE.FrontSide}
        />
      </mesh>

      {/* Soft atmospheric rim at the horizon — a slightly larger translucent
          shell that fades toward the sky so the curve disappears gracefully
          rather than ending in a hard line. */}
      <mesh position={[0, GLOBE_CENTER_Y, 0]}>
        <sphereGeometry args={[GLOBE_R + 0.4, 96, 48, 0, Math.PI * 2, Math.PI * 0.32, Math.PI * 0.18]} />
        <meshBasicMaterial color={SKY} transparent opacity={0.55} depthWrite={false} side={THREE.BackSide} />
      </mesh>
    </>
  )
}

function NebulaPuff({
  position, color, opacity, radius,
}: { position: [number, number, number]; color: string; opacity: number; radius: number }) {
  return (
    <mesh position={position}>
      <sphereGeometry args={[radius, 24, 24]} />
      <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} blending={THREE.AdditiveBlending} />
    </mesh>
  )
}
