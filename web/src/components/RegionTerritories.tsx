/**
 * RegionTerritories — renders each category's "territory" on the globe:
 *  - a translucent, globe-conforming colour wedge fanning out from the pole
 *    along the category's angular sector, and
 *  - a floating label naming the territory (+ project count).
 *
 * The wedge geometry is a ring-segment whose vertices are displaced down onto
 * the sphere surface (same trick as House3D's erosion patches), so the tint
 * hugs the curvature instead of floating as a flat disc.
 */
import { useMemo } from 'react'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import { groundYAt } from '../lib/globe'
import type { Region } from '../lib/regions'

const INNER_R = 3
const OUTER_R = 30

function Territory({ region, dimmed }: { region: Region; dimmed: boolean }) {
  const geometry = useMemo(() => {
    // RingGeometry's local +θ maps to world −angle after we lay it flat, so
    // negate to align the wedge with the spires sitting at `angleCenter`.
    const thetaStart = -(region.angleCenter + region.angleHalfWidth)
    const thetaLength = region.angleHalfWidth * 2
    const geo = new THREE.RingGeometry(INNER_R, OUTER_R, 28, 24, thetaStart, thetaLength)
    geo.rotateX(-Math.PI / 2)
    const pos = geo.attributes.position!.array as Float32Array
    for (let i = 0; i < pos.length; i += 3) {
      // Lift a hair above the surface; polygonOffset + depthWrite:false keep it
      // from z-fighting the moon.
      pos[i + 1] = groundYAt(pos[i]!, pos[i + 2]!) + 0.04
    }
    geo.attributes.position!.needsUpdate = true
    geo.computeVertexNormals()
    return geo
  }, [region.angleCenter, region.angleHalfWidth])

  // Label sits partway out along the sector's centre bearing.
  const labelR = 13
  const lx = Math.cos(region.angleCenter) * labelR
  const lz = Math.sin(region.angleCenter) * labelR
  const ly = groundYAt(lx, lz)

  return (
    <group>
      <mesh geometry={geometry} renderOrder={-1}>
        <meshBasicMaterial
          color={region.color}
          transparent
          opacity={dimmed ? 0.05 : 0.13}
          depthWrite={false}
          side={THREE.DoubleSide}
          polygonOffset
          polygonOffsetFactor={-2}
          polygonOffsetUnits={-2}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      <Html
        position={[lx, ly + 2.4, lz]}
        center
        transform={false}
        occlude={false}
        zIndexRange={[8, 0]}
        style={{ pointerEvents: 'none' }}
      >
        <div className="region-label" style={{ opacity: dimmed ? 0.35 : 1 }}>
          <span className="region-dot" style={{ background: region.color }} />
          {region.label}
          <span className="region-count">{region.count}</span>
        </div>
      </Html>
    </group>
  )
}

export function RegionTerritories({ regions, dimmed = false }: { regions: Region[]; dimmed?: boolean }) {
  return (
    <>
      {regions.map((r) => (
        <Territory key={r.category} region={r} dimmed={dimmed} />
      ))}
    </>
  )
}
