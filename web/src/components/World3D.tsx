/**
 * World3D — 3D portfolio canvas (replaces the 2D World per user upgrade).
 *
 * Camera: orbit + dolly (Google-Earth-ish). Click a spire → camera animates
 * in close → interior panel appears anchored to the spire. ESC / "recenter"
 * snaps the camera back to a wide overview.
 *
 * Time-travel scrubber, HUD, WorldSpend, Ticker, AddProject, Interior all
 * stay as 2D HTML overlays for clarity — they sit outside or beside the Canvas.
 */
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Html } from '@react-three/drei'
import * as THREE from 'three'
import { api } from '../lib/api'
import { position3DFor, relaxPositions } from '../lib/position3d'
import { groundYAt } from '../lib/globe'
import { computeHeight, spireRadii, type ProjectActivity } from '../lib/dimensions'
import { deriveProjectsAt } from '../lib/derive'
import { Scene3D } from './Scene3D'
import { House3D, STAGE_COLOR } from './House3D'
import { Ecosystem } from './Ecosystem'
import { AddProject } from './AddProject'
import { HUD } from './HUD'
import { WorldSpend } from './WorldSpend'
import { Ticker } from './Ticker'
import { Scrubber } from './Scrubber'
import { Legend } from './Legend'
import { SearchBar } from './SearchBar'
import { Radar } from './Radar'
import { Meteors, type MeteorSpec } from './Meteors'
import { matchesQuery } from '../lib/search'
import type { ProjectState, ProjectEvent } from '../lib/types'

// Camera choreography.
//   START_CAM    — opening shot, way out in space looking at the world
//   DEFAULT_CAM  — settled overview after the flythrough lands
//   FOCUS_*      — where we put the camera when a spire is clicked
const START_CAM     = new THREE.Vector3(8, 55, 90)
const DEFAULT_CAM   = new THREE.Vector3(0, 22, 28)
const DEFAULT_TARGET = new THREE.Vector3(0, 1, 0)
const FOCUS_DISTANCE = 9
const FOCUS_HEIGHT = 6.5
const FOCUS_TARGET_Y = 3.2  // looking roughly at the spire's cap so the
                             // ecosystem panel (rising above it) reads as
                             // emerging from the obelisk in the lower half
                             // of frame.

interface CameraTarget {
  position: THREE.Vector3
  target: THREE.Vector3
  /** Higher = snappier lerp. ~2.2 for normal clicks, ~0.7 for the cinematic intro. */
  ease?: number
}

/**
 * CameraRig — lerps the camera + target to a goal each frame, then BAILS
 * when the goal is essentially reached so the user's pan/rotate/zoom isn't
 * fought every frame. Goal is also cleared externally on OrbitControls'
 * 'start' event (see World3D below) so any user input takes immediate priority.
 */
function CameraRig({
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
    // Within ~0.05u of the goal? Hand control back to the user.
    if (camera.position.distanceToSquared(goal.position) < 0.0025) {
      onReached()
    }
  })
  return null
}

export function World3D({ onLogout }: { onLogout: () => void }) {
  const [projects, setProjects] = useState<ProjectState[] | null>(null)
  const [events, setEvents] = useState<ProjectEvent[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [freshSlugs, setFreshSlugs] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [meteors, setMeteors] = useState<MeteorSpec[]>([])
  const meteorId = useRef(0)
  const [asOf, setAsOf] = useState<number | null>(null)
  const [camGoal, setCamGoal] = useState<CameraTarget | null>(null)
  const [intro, setIntro] = useState(true)
  const projectsRef = useRef<ProjectState[] | null>(null)
  const asOfRef = useRef<number | null>(null)
  const controlsRef = useRef<any>(null)

  useEffect(() => { projectsRef.current = projects }, [projects])
  useEffect(() => { asOfRef.current = asOf }, [asOf])

  // Initial load + opening flythrough.
  // The Canvas starts the camera at START_CAM (far out in space). Once the
  // world data lands, we set the goal to DEFAULT_CAM with a slow ease so the
  // camera glides in over ~4 seconds. User input cancels nothing; OrbitControls
  // stay live the whole time and any drag/wheel snaps to manual control.
  useEffect(() => {
    let cancelled = false
    Promise.all([api.world(), api.events()])
      .then(([w, e]) => {
        if (cancelled) return
        setProjects(w)
        setEvents(e)
        // Cinematic ease (lower = slower)
        setCamGoal({ position: DEFAULT_CAM.clone(), target: DEFAULT_TARGET.clone(), ease: 0.65 })
        // After the intro window, switch future goals to snappy ease.
        const t = setTimeout(() => setIntro(false), 4200)
        return () => clearTimeout(t)
      })
      .catch((e) => { if (!cancelled) setErr(e?.message ?? 'load failed') })
    return () => { cancelled = true }
  }, [])

  // Polling
  useEffect(() => {
    if (!projects) return
    let id: ReturnType<typeof setInterval> | null = null
    const timeouts: ReturnType<typeof setTimeout>[] = []
    const tick = async () => {
      if (asOfRef.current !== null) return
      try {
        const next = await api.world()
        const prev = projectsRef.current ?? []
        const prevByslug = new Map(prev.map((p) => [p.slug, p]))
        const changed: string[] = []
        for (const p of next) {
          const old = prevByslug.get(p.slug)
          if (!old || old.last_activity_ts !== p.last_activity_ts || old.status !== p.status) {
            changed.push(p.slug)
          }
        }
        setProjects(next)
        api.events().then(setEvents).catch(() => {})
        if (changed.length > 0) {
          setFreshSlugs((curr) => {
            const out = new Set(curr); for (const s of changed) out.add(s); return out
          })
          // Spawn a meteor toward each project that just gained activity.
          const byId = new Map(next.map((p) => [p.slug, p]))
          const spawned: MeteorSpec[] = changed.map((s) => ({
            id: ++meteorId.current,
            slug: s,
            color: STAGE_COLOR[byId.get(s)?.stage ?? 'wip'] ?? STAGE_COLOR.wip,
          }))
          setMeteors((curr) => [...curr, ...spawned])
          for (const s of changed) {
            const t = setTimeout(() => setFreshSlugs((curr) => {
              if (!curr.has(s)) return curr
              const out = new Set(curr); out.delete(s); return out
            }), 2600)
            timeouts.push(t)
          }
          // Prune the meteors once they've finished their ~2.6s fall.
          const ids = spawned.map((m) => m.id)
          const tm = setTimeout(() => {
            setMeteors((curr) => curr.filter((m) => !ids.includes(m.id)))
          }, 3200)
          timeouts.push(tm)
        }
      } catch { /* swallow */ }
    }
    const start = () => { if (id === null) id = setInterval(tick, 4000) }
    const stop  = () => { if (id !== null) { clearInterval(id); id = null } }
    const onVis = () => { document.visibilityState === 'hidden' ? stop() : start() }
    if (document.visibilityState !== 'hidden') start()
    document.addEventListener('visibilitychange', onVis)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVis)
      for (const t of timeouts) clearTimeout(t)
    }
  }, [projects !== null])

  // Derived display state (live or as-of)
  const displayProjects = useMemo(() => {
    if (!projects) return []
    if (asOf === null) return projects
    return deriveProjectsAt(projects, events, asOf)
  }, [projects, events, asOf])

  // Per-project commit + total-event count at the current as-of moment.
  // Drives both the spire height (decoupled from status now) and stays
  // honest when the scrubber is engaged.
  const projectActivity = useMemo(() => {
    const m = new Map<string, ProjectActivity>()
    // Track the timestamp of the latest code_bytes metric per project so the
    // most recent code-size reading wins regardless of event ordering.
    const codeBytesTs = new Map<string, number>()
    for (const e of events) {
      const ets = Date.parse(e.ts)
      if (asOf !== null && ets > asOf) continue
      const cur = m.get(e.project_id) ?? { commits: 0, totalEvents: 0 }
      cur.totalEvents++
      if (e.type === 'github_commit') cur.commits++
      if (e.type === 'metric') {
        const p = e.payload as { name?: string; value?: number }
        if (p.name === 'code_bytes' && typeof p.value === 'number') {
          const prevTs = codeBytesTs.get(e.project_id) ?? -Infinity
          if (ets >= prevTs) { codeBytesTs.set(e.project_id, ets); cur.codeBytes = p.value }
        }
      }
      m.set(e.project_id, cur)
    }
    return m
  }, [events, asOf])

  // Place each project in world XZ — distance is recency-based, bearing is a
  // stable per-slug hash. Height comes from code size. A relaxation pass then
  // pushes any overlapping spires apart so a crowded world keeps a little gap
  // between buildings.
  const positioned = useMemo(() => {
    const raw = displayProjects.map((p) => {
      const stat = projectActivity.get(p.id) ?? { commits: 0, totalEvents: 0 }
      const pos = position3DFor(p, asOf ?? Date.now())
      const height = computeHeight(stat)
      const footprint = spireRadii(height).bottomRadius * 1.6  // matches House3D baseRadius
      return { p, x: pos.x, z: pos.z, height, footprint, fixed: !!p.manual_position }
    })
    const relaxed = relaxPositions(raw, 0.7, 18)
    return relaxed.map(({ p, x, z, height }) => ({ p, x, z, height }))
  }, [displayProjects, projectActivity, asOf])

  // Active search → set of matching slugs (null = no search, treat all normal).
  const matchedSlugs = useMemo(() => {
    if (!query.trim()) return null
    return new Set(displayProjects.filter((p) => matchesQuery(p, query)).map((p) => p.slug))
  }, [displayProjects, query])

  // Flat list for the radar minimap (dots coloured by lifecycle stage).
  const radarItems = useMemo(
    () => positioned.map(({ p, x, z }) => ({ slug: p.slug, name: p.name, x, z, stage: p.stage })),
    [positioned],
  )

  // Click → camera dolly to spire. Frame the spire in the lower half of the
  // viewport so the ecosystem panel (which emerges from the cap and floats
  // upward) has the upper half clear to be read.
  const focusOn = useCallback((slug: string) => {
    const entry = positioned.find((e) => e.p.slug === slug)
    if (!entry) return
    setSelected(slug)
    // Spires now sit on the curved globe surface — focus offsets are relative
    // to the local ground Y at the spire's (x, z), not world origin.
    const surfaceY = groundYAt(entry.x, entry.z)
    const target = new THREE.Vector3(entry.x, surfaceY + FOCUS_TARGET_Y, entry.z)
    const len = Math.max(1, Math.hypot(entry.x, entry.z))
    const dx = entry.x / len
    const dz = entry.z / len
    const p = new THREE.Vector3(
      entry.x + dx * FOCUS_DISTANCE,
      surfaceY + FOCUS_HEIGHT,
      entry.z + dz * FOCUS_DISTANCE,
    )
    setCamGoal({ position: p, target, ease: intro ? 1.2 : 2.2 })
  }, [positioned, intro])

  const recenter = useCallback(() => {
    setSelected(null)
    setCamGoal({ position: DEFAULT_CAM.clone(), target: DEFAULT_TARGET.clone(), ease: 2.2 })
  }, [])

  // ESC handler
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === 'r') recenter()
      else if (e.key === 'n') setShowAdd(true)
      else if (e.key === 'Escape') {
        if (showAdd) setShowAdd(false)
        else if (selected) recenter()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [recenter, showAdd, selected])

  // The instant the user grabs the controls, drop any pending camera goal so
  // the cinematic / focus animation doesn't fight pan, rotate, or zoom.
  useEffect(() => {
    if (!projects) return
    const c = controlsRef.current
    if (!c) return
    const onStart = () => setCamGoal(null)
    c.addEventListener('start', onStart)
    return () => c.removeEventListener('start', onStart)
  }, [projects])

  const anyInterior = selected !== null && asOf === null
  const selectedEntry = anyInterior ? positioned.find((e) => e.p.slug === selected) : null

  // Top-of-spire Y derived from the project's dynamic height + the base disc.
  const BASE_HEIGHT = 0.16  // keep in sync with House3D
  function dimsTopFor(_status: ProjectState['status'], height: number): number {
    return BASE_HEIGHT + height + 0.4  // a bit above the cap
  }

  if (err) return <div className="full-error">could not load world: {err}</div>
  if (!projects) return <div className="loading">loading the world…</div>

  return (
    <div className="world-shell world-3d">
      <Canvas
        camera={{ position: START_CAM.toArray() as [number, number, number], fov: 50, near: 0.1, far: 600 }}
        shadows
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        onPointerMissed={() => { if (selected) recenter() }}
      >
        <Suspense fallback={null}>
          <Scene3D />
        </Suspense>

        <Meteors meteors={meteors} entries={positioned.map(({ p, x, z, height }) => ({ slug: p.slug, x, z, height }))} />

        <OrbitControls
          ref={controlsRef}
          target={DEFAULT_TARGET.toArray() as [number, number, number]}
          enableDamping
          enablePan
          enableRotate
          enableZoom
          minDistance={3}
          maxDistance={90}
          minPolarAngle={0.15}
          maxPolarAngle={Math.PI / 2 - 0.04}
          dampingFactor={0.09}
          panSpeed={1.2}
          rotateSpeed={0.55}
          zoomSpeed={0.9}
          keyPanSpeed={28}
          screenSpacePanning={false}
          // Google-Earth-style mapping: drag pans the ground, right-drag rotates,
          // wheel zooms. WASD / arrows also pan.
          mouseButtons={{
            LEFT:   THREE.MOUSE.PAN,
            MIDDLE: THREE.MOUSE.DOLLY,
            RIGHT:  THREE.MOUSE.ROTATE,
          }}
          touches={{
            ONE: THREE.TOUCH.PAN,
            TWO: THREE.TOUCH.DOLLY_ROTATE,
          }}
          // Arrow keys + WASD pan along the ground plane.
          keys={{ LEFT: 'KeyA', UP: 'KeyW', RIGHT: 'KeyD', BOTTOM: 'KeyS' }}
          listenToKeyEvents={typeof window !== 'undefined' ? window : undefined}
          makeDefault
        />
        <CameraRig goal={camGoal} onReached={() => setCamGoal(null)} controlsRef={controlsRef} />

        <Suspense fallback={null}>
          {positioned.map(({ p, x, z, height }) => (
            <House3D
              key={p.id}
              project={p}
              x={x}
              z={z}
              height={height}
              selected={selected === p.slug}
              anyInterior={anyInterior}
              fresh={freshSlugs.has(p.slug)}
              searchMiss={matchedSlugs ? !matchedSlugs.has(p.slug) : false}
              searchHit={matchedSlugs ? matchedSlugs.has(p.slug) : false}
              onClick={focusOn}
            />
          ))}
        </Suspense>

        {/* The Ecosystem mind-map emerges from the selected spire. Anchored in
            3D so it visibly comes out of the obelisk; CSS handles the
            scale-up + float-up emerge animation. */}
        {anyInterior && selectedEntry && (
          <Html
            position={[
              selectedEntry.x,
              groundYAt(selectedEntry.x, selectedEntry.z) + dimsTopFor(selectedEntry.p.status, selectedEntry.height) + 1.2,
              selectedEntry.z,
            ]}
            center
            transform={false}
            occlude={false}
            zIndexRange={[30, 0]}
            style={{ pointerEvents: 'auto' }}
          >
            <Ecosystem
              project={selectedEntry.p}
              onClose={recenter}
              onUpdated={(p) => setProjects((curr) => curr?.map((x) => (x.id === p.id ? { ...x, ...p } : x)) ?? curr)}
            />
          </Html>
        )}
      </Canvas>

      <HUD
        scale={1}
        count={displayProjects.length}
        onRecenter={recenter}
        onAddProject={() => setShowAdd(true)}
        onLogout={onLogout}
      />
      <Legend />
      <SearchBar
        query={query}
        onChange={setQuery}
        matchCount={matchedSlugs ? matchedSlugs.size : displayProjects.length}
        total={displayProjects.length}
      />
      <Radar items={radarItems} controlsRef={controlsRef} onFocus={focusOn} matchSlugs={matchedSlugs} />

      {asOf === null && <WorldSpend />}
      <Scrubber projects={projects ?? []} events={events} asOf={asOf} setAsOf={setAsOf} />
      <Ticker />

      {showAdd && (
        <AddProject
          onClose={() => setShowAdd(false)}
          onCreated={(p) => {
            setProjects((curr) => (curr ? [p, ...curr] : [p]))
            setShowAdd(false)
            setTimeout(() => focusOn(p.slug), 80)
          }}
        />
      )}
    </div>
  )
}
