/**
 * PublicWorld — the read-only, sanitized 3D world that visitors (recruiters)
 * see. Same globe + spires as the owner world, fed entirely by the `/public/*`
 * endpoints (anon-key, sanitized views): no spend, no metrics, no private
 * repos, no editing, no time-travel, no owner controls.
 *
 * The security boundary is the API/DB, not this component — `/public/*` only
 * ever returns safe data. This view just renders it nicely.
 */
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { publicApi } from '../lib/api'
import { position3DFor, relaxPositions } from '../lib/position3d'
import { computeHeight, spireRadii } from '../lib/dimensions'
import { groundYAt } from '../lib/globe'
import { matchesQuery } from '../lib/search'
import { deriveProjectsAt } from '../lib/derive'
import { Scene3D } from './Scene3D'
import { House3D } from './House3D'
import { Legend } from './Legend'
import { SearchBar } from './SearchBar'
import { Radar } from './Radar'
import { Scrubber } from './Scrubber'
import { CameraRig, type CameraTarget } from './CameraRig'
import { PublicProjectCard } from './PublicProjectCard'
import type { ProjectState, ProjectEvent, PublicProjectState, PublicEvent } from '../lib/types'

const START_CAM      = new THREE.Vector3(8, 55, 90)
const DEFAULT_CAM    = new THREE.Vector3(0, 22, 28)
const DEFAULT_TARGET = new THREE.Vector3(0, 1, 0)
const FOCUS_DISTANCE = 12
const FOCUS_HEIGHT   = 6.5

// Adapt the sanitized public shape to a ProjectState so the shared 3D pieces
// (House3D, positioning, search) just work. Owner-only fields are nulled out.
function asProjectState(p: PublicProjectState): ProjectState {
  return {
    id: p.slug,
    slug: p.slug,
    name: p.name,
    category: p.category,
    goal: p.goal,
    repo: p.repo,
    live_url: p.live_url,
    tech_stack: p.tech_stack,
    stage: p.stage,
    manual_position: null,
    created_at: p.created_at,
    last_activity_ts: p.last_activity_ts,
    status: p.status,
    next_step: null,
    commits_30d: p.commits_30d,
    code_bytes: p.code_bytes,
  }
}

export function PublicWorld() {
  const [projects, setProjects] = useState<PublicProjectState[] | null>(null)
  const [events, setEvents] = useState<PublicEvent[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [asOf, setAsOf] = useState<number | null>(null)
  const [camGoal, setCamGoal] = useState<CameraTarget | null>(null)
  const [intro, setIntro] = useState(true)
  const [lockedToast, setLockedToast] = useState(false)
  const controlsRef = useRef<any>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([publicApi.world(), publicApi.recentEvents(5000)])
      .then(([w, e]) => {
        if (cancelled) return
        setProjects(w)
        setEvents(e)
        setCamGoal({ position: DEFAULT_CAM.clone(), target: DEFAULT_TARGET.clone(), ease: 0.65 })
        const t = setTimeout(() => setIntro(false), 4200)
        return () => clearTimeout(t)
      })
      .catch((e) => { if (!cancelled) setErr(e?.message ?? 'load failed') })
    return () => { cancelled = true }
  }, [])

  // Which (anonymized) slugs are locked private towers.
  const privateSet = useMemo(
    () => new Set((projects ?? []).filter((p) => p.private).map((p) => p.slug)),
    [projects],
  )

  // Public events mapped to the ProjectEvent shape the time-travel derivation
  // expects (public projects use slug as id; private events aren't exposed).
  const mappedEvents = useMemo<ProjectEvent[]>(
    () => events.map((e) => ({
      id: e.id,
      project_id: e.project_slug ?? '',
      ts: e.ts,
      type: e.type,
      summary: e.summary,
      payload: {},
      source: 'github',
    })),
    [events],
  )

  const adapted = useMemo(() => (projects ?? []).map(asProjectState), [projects])

  // Live, or re-derived at the scrubbed `asOf`.
  const displayProjects = useMemo(
    () => (asOf === null ? adapted : deriveProjectsAt(adapted, mappedEvents, asOf)),
    [adapted, mappedEvents, asOf],
  )

  // Position by recency, size by code bytes, then relax so the world keeps a
  // little gap. Private towers look exactly like public ones here — they're
  // only different on click (blocked, see focusOn).
  const positioned = useMemo(() => {
    const raw = displayProjects.map((ps) => {
      const pos = position3DFor(ps, asOf ?? Date.now())
      const height = computeHeight({ commits: ps.commits_30d, totalEvents: ps.commits_30d, codeBytes: ps.code_bytes ?? undefined })
      const footprint = spireRadii(height).bottomRadius * 1.6
      // Private towers look normal but their name carries a lock.
      const p: ProjectState = privateSet.has(ps.slug) ? { ...ps, name: `🔒 ${ps.name}` } : ps
      return { p, x: pos.x, z: pos.z, height, footprint, fixed: false }
    })
    return relaxPositions(raw, 0.7, 18).map(({ p, x, z, height }) => ({ p, x, z, height }))
  }, [displayProjects, privateSet, asOf])

  const matchedSlugs = useMemo(() => {
    if (!query.trim()) return null
    return new Set(positioned.filter((e) => matchesQuery(e.p, query)).map((e) => e.p.slug))
  }, [positioned, query])

  const radarItems = useMemo(
    () => positioned.map(({ p, x, z }) => ({ slug: p.slug, name: p.name, x, z, stage: p.stage })),
    [positioned],
  )

  const focusOn = useCallback((slug: string) => {
    const entry = positioned.find((e) => e.p.slug === slug)
    if (!entry) return
    // Private tower: don't open it — just flash a small "can't view" alert.
    if (privateSet.has(slug)) {
      setLockedToast(true)
      window.setTimeout(() => setLockedToast(false), 2600)
      return
    }
    setSelected(slug)
    const surfaceY = groundYAt(entry.x, entry.z)
    const target = new THREE.Vector3(entry.x, surfaceY + entry.height * 0.5 + 1.2, entry.z)
    const len = Math.max(1, Math.hypot(entry.x, entry.z))
    const dx = entry.x / len, dz = entry.z / len
    const pos = new THREE.Vector3(
      entry.x + dx * FOCUS_DISTANCE,
      surfaceY + FOCUS_HEIGHT + entry.height * 0.4,
      entry.z + dz * FOCUS_DISTANCE,
    )
    setCamGoal({ position: pos, target, ease: intro ? 1.2 : 2.2 })
  }, [positioned, intro, privateSet])

  const recenter = useCallback(() => {
    setSelected(null)
    setCamGoal({ position: DEFAULT_CAM.clone(), target: DEFAULT_TARGET.clone(), ease: 2.2 })
  }, [])

  // Drop the camera goal the moment the user grabs the controls.
  useEffect(() => {
    if (!projects) return
    const c = controlsRef.current
    if (!c) return
    const onStart = () => setCamGoal(null)
    c.addEventListener('start', onStart)
    return () => c.removeEventListener('start', onStart)
  }, [projects])

  const anyInterior = selected !== null

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

        <OrbitControls
          ref={controlsRef}
          target={DEFAULT_TARGET.toArray() as [number, number, number]}
          enableDamping enablePan enableRotate enableZoom
          minDistance={3} maxDistance={90}
          minPolarAngle={0.15} maxPolarAngle={Math.PI / 2 - 0.04}
          dampingFactor={0.09} panSpeed={1.2} rotateSpeed={0.55} zoomSpeed={0.9}
          keyPanSpeed={28}
          screenSpacePanning={false}
          mouseButtons={{ LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }}
          touches={{ ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE }}
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
              fresh={false}
              searchMiss={matchedSlugs ? !matchedSlugs.has(p.slug) : false}
              searchHit={matchedSlugs ? matchedSlugs.has(p.slug) : false}
              onClick={focusOn}
            />
          ))}
        </Suspense>
      </Canvas>

      <div className="hud hud-tl">
        <span className="hud-label">project world</span>
        <span className="hud-meta">{positioned.length} projects · public view</span>
      </div>
      <div className="hud hud-tr">
        <a className="public-owner-link" href="/login" title="Owner sign-in">owner →</a>
      </div>

      <Legend />
      <SearchBar
        query={query}
        onChange={setQuery}
        matchCount={matchedSlugs ? matchedSlugs.size : positioned.length}
        total={positioned.length}
      />
      <Radar items={radarItems} controlsRef={controlsRef} onFocus={focusOn} matchSlugs={matchedSlugs} />
      <Scrubber projects={adapted} events={mappedEvents} asOf={asOf} setAsOf={setAsOf} />

      {selected && <PublicProjectCard slug={selected} onClose={recenter} />}

      {lockedToast && (
        <div className="locked-toast">
          🔒 This one’s private — want a closer look? <strong>Reach out and I’ll walk you through it.</strong>
        </div>
      )}
    </div>
  )
}
