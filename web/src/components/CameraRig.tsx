/**
 * Shared camera rig for the owner and public 3D worlds.
 *
 * Lerps the camera + orbit target toward a goal each frame, then BAILS once
 * it's essentially reached so the user's pan/rotate/zoom isn't fought. The goal
 * is also cleared on OrbitControls' 'start' event by the parent, so any user
 * input takes immediate priority. Each world keeps its own camera constants and
 * focus framing; only this rig + the goal shape are shared.
 */
import { useFrame, useThree } from '@react-three/fiber'

export interface CameraTarget {
  position: import('three').Vector3
  target: import('three').Vector3
  /** Higher = snappier lerp. ~2.2 for normal clicks, ~0.7 for the cinematic intro. */
  ease?: number
}

export function CameraRig({
  goal,
  onReached,
  controlsRef,
}: {
  goal: CameraTarget | null
  onReached: () => void
  controlsRef: React.MutableRefObject<any>
}) {
  const { camera } = useThree()
  useFrame((_state, delta) => {
    if (!goal || !controlsRef.current) return
    const controls = controlsRef.current
    const ease = goal.ease ?? 2.2
    const alpha = 1 - Math.pow(0.001, delta)
    camera.position.lerp(goal.position, Math.min(1, alpha * ease))
    controls.target.lerp(goal.target, Math.min(1, alpha * ease))
    controls.update()
    if (camera.position.distanceToSquared(goal.position) < 0.0025) {
      onReached()
    }
  })
  return null
}
