import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useGesture } from '@use-gesture/react'
import { api } from '../lib/api'
import { computePosition } from '../lib/position'
import { deriveProjectsAt } from '../lib/derive'
import { House, INTERIOR_ENTER, MID_ENTER } from './House'
import { AddProject } from './AddProject'
import { HUD } from './HUD'
import { WorldSpend } from './WorldSpend'
import { Ticker } from './Ticker'
import { Scrubber } from './Scrubber'
import type { ProjectState, ProjectEvent } from '../lib/types'

interface Camera { x: number; y: number; scale: number }

const MIN_ZOOM = 0.15
const MAX_ZOOM = 6
const INITIAL: Camera = { x: 0, y: 0, scale: 1 }

// Target scale when entering interior mode on click.
const FOCUS_SCALE = INTERIOR_ENTER + 0.6

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export function World({ onLogout }: { onLogout: () => void }) {
  const [projects, setProjects] = useState<ProjectState[] | null>(null)
  const [events, setEvents] = useState<ProjectEvent[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [camera, setCamera] = useState<Camera>(INITIAL)
  const [selected, setSelected] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [freshSlugs, setFreshSlugs] = useState<Set<string>>(new Set())
  const [asOf, setAsOf] = useState<number | null>(null)  // null = live "now"
  const viewportRef = useRef<HTMLDivElement>(null)
  const animRef = useRef<number | null>(null)
  const projectsRef = useRef<ProjectState[] | null>(null)
  const asOfRef = useRef<number | null>(null)

  useEffect(() => { projectsRef.current = projects }, [projects])
  useEffect(() => { asOfRef.current = asOf }, [asOf])

  // Initial load
  useEffect(() => {
    let cancelled = false
    Promise.all([api.world(), api.events()])
      .then(([w, e]) => {
        if (cancelled) return
        setProjects(w)
        setEvents(e)
      })
      .catch((e) => { if (!cancelled) setErr(e?.message ?? 'load failed') })
    return () => { cancelled = true }
  }, [])

  // Live polling: every 4s, refetch /api/world and diff. Projects whose
  // last_activity_ts moved get a brief "fresh" pulse animation.
  // Paused when the tab is hidden so a backgrounded session doesn't waste
  // bandwidth/battery (was a Phase 3 review finding).
  useEffect(() => {
    if (!projects) return
    let id: ReturnType<typeof setInterval> | null = null
    const timeouts: ReturnType<typeof setTimeout>[] = []

    const tick = async () => {
      // Pause polling while the scrubber is engaged.
      if (asOfRef.current !== null) return
      try {
        const next = await api.world()
        const prev = projectsRef.current ?? []
        const prevByslug = new Map(prev.map((p) => [p.slug, p]))
        const changedSlugs: string[] = []
        for (const p of next) {
          const old = prevByslug.get(p.slug)
          if (!old || old.last_activity_ts !== p.last_activity_ts || old.status !== p.status) {
            changedSlugs.push(p.slug)
          }
        }
        setProjects(next)
        // Refresh event stream too so the scrubber sees newly-arrived events.
        api.events().then(setEvents).catch(() => {})
        if (changedSlugs.length > 0) {
          setFreshSlugs((curr) => {
            const out = new Set(curr)
            for (const s of changedSlugs) out.add(s)
            return out
          })
          for (const s of changedSlugs) {
            const t = setTimeout(() => {
              setFreshSlugs((curr) => {
                if (!curr.has(s)) return curr
                const out = new Set(curr)
                out.delete(s)
                return out
              })
            }, 2600)
            timeouts.push(t)
          }
        }
      } catch { /* swallow transient errors */ }
    }

    const start = () => { if (id === null) id = setInterval(tick, 4000) }
    const stop = () => { if (id !== null) { clearInterval(id); id = null } }
    const onVis = () => { document.visibilityState === 'hidden' ? stop() : start() }

    if (document.visibilityState !== 'hidden') start()
    document.addEventListener('visibilitychange', onVis)

    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVis)
      for (const t of timeouts) clearTimeout(t)
    }
  }, [projects !== null])

  // Center camera on first load
  useEffect(() => {
    if (projects && projects.length > 0 && viewportRef.current) {
      const w = viewportRef.current.clientWidth
      const h = viewportRef.current.clientHeight
      setCamera({ x: w / 2, y: h / 2, scale: 1 })
    }
  }, [projects?.length])

  // Derived state: if asOf is null, use live projects; else replay event stream.
  const displayProjects = useMemo(() => {
    if (!projects) return []
    if (asOf === null) return projects
    return deriveProjectsAt(projects, events, asOf)
  }, [projects, events, asOf])

  const positioned = useMemo(
    () => displayProjects.map((p) => ({ p, pos: computePosition(p) })),
    [displayProjects],
  )

  // Cancel any in-flight camera animation
  const stopAnim = useCallback(() => {
    if (animRef.current !== null) {
      cancelAnimationFrame(animRef.current)
      animRef.current = null
    }
  }, [])

  // Smoothly tween camera over ~420ms
  const animateCamera = useCallback((target: Camera) => {
    stopAnim()
    const start = { ...camera }
    const startTime = performance.now()
    const duration = 420
    const step = (now: number) => {
      const t = Math.min(1, (now - startTime) / duration)
      const e = easeOutCubic(t)
      setCamera({
        x: lerp(start.x, target.x, e),
        y: lerp(start.y, target.y, e),
        scale: lerp(start.scale, target.scale, e),
      })
      if (t < 1) animRef.current = requestAnimationFrame(step)
      else animRef.current = null
    }
    animRef.current = requestAnimationFrame(step)
  }, [camera, stopAnim])

  const bind = useGesture(
    {
      onDrag: ({ delta: [dx, dy], event }) => {
        if ((event.target as HTMLElement | null)?.closest('.house')) return
        stopAnim()
        setCamera((c) => ({ ...c, x: c.x + dx, y: c.y + dy }))
      },
      onWheel: ({ delta: [, dy], event }) => {
        event.preventDefault()
        stopAnim()
        const factor = Math.exp(-dy * 0.0015)
        setCamera((c) => {
          const newScale = clamp(c.scale * factor, MIN_ZOOM, MAX_ZOOM)
          if (newScale === c.scale) return c
          const rect = viewportRef.current?.getBoundingClientRect()
          if (!rect) return { ...c, scale: newScale }
          const mx = (event as WheelEvent).clientX - rect.left
          const my = (event as WheelEvent).clientY - rect.top
          const ratio = newScale / c.scale
          return {
            scale: newScale,
            x: mx - (mx - c.x) * ratio,
            y: my - (my - c.y) * ratio,
          }
        })
      },
      onPinch: ({ offset: [s] }) => {
        stopAnim()
        setCamera((c) => ({ ...c, scale: clamp(s, MIN_ZOOM, MAX_ZOOM) }))
      },
    },
    { wheel: { eventOptions: { passive: false } } },
  )

  const recenter = useCallback(() => {
    if (!viewportRef.current) return
    const w = viewportRef.current.clientWidth
    const h = viewportRef.current.clientHeight
    setSelected(null)
    animateCamera({ x: w / 2, y: h / 2, scale: 1 })
  }, [animateCamera])

  // Click house → smooth-zoom. While scrubbing we stop at mid-tier so the
  // interior (which fetches current data) doesn't engage on a past timestamp.
  const focusOn = useCallback((slug: string) => {
    if (!viewportRef.current) return
    const p = displayProjects.find((q) => q.slug === slug)
    if (!p) return
    const pos = computePosition(p)
    const w = viewportRef.current.clientWidth
    const h = viewportRef.current.clientHeight
    const target = asOf !== null ? MID_ENTER + 0.2 : FOCUS_SCALE
    setSelected(slug)
    animateCamera({
      scale: target,
      x: w / 2 - pos.x * target,
      y: h / 2 - pos.y * target,
    })
  }, [displayProjects, animateCamera, asOf])

  // Exit interior: zoom out to 1×, clear selection
  const closeInterior = useCallback(() => {
    if (!viewportRef.current) return
    const w = viewportRef.current.clientWidth
    const h = viewportRef.current.clientHeight
    setSelected(null)
    animateCamera({ x: w / 2, y: h / 2, scale: 1 })
  }, [animateCamera])

  // Click on empty canvas → if zoomed in, exit; else just deselect
  const onViewportClick = useCallback(() => {
    if (camera.scale >= INTERIOR_ENTER) {
      closeInterior()
    } else {
      setSelected(null)
    }
  }, [camera.scale, closeInterior])

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === 'r') recenter()
      else if (e.key === 'n') setShowAdd(true)
      else if (e.key === 'Escape') {
        if (showAdd) setShowAdd(false)
        else if (selected) closeInterior()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [recenter, closeInterior, showAdd, selected])

  // Cleanup animation on unmount
  useEffect(() => stopAnim, [stopAnim])

  if (err) return <div className="full-error">could not load world: {err}</div>
  if (!projects) return <div className="loading">loading the world…</div>

  return (
    <div className="world-shell">
      <div
        ref={viewportRef}
        className="viewport"
        {...bind()}
        onClick={onViewportClick}
      >
        <div
          className="stage"
          style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})` }}
        >
          {positioned.map(({ p, pos }) => (
            <House
              key={p.id}
              project={p}
              x={pos.x}
              y={pos.y}
              scale={camera.scale}
              selected={selected === p.slug}
              anyInterior={!!selected && camera.scale >= INTERIOR_ENTER && asOf === null}
              fresh={freshSlugs.has(p.slug)}
              inverseScale={1 / Math.max(0.4, camera.scale)}
              suppressInterior={asOf !== null}
              onClick={focusOn}
              onClose={closeInterior}
            />
          ))}
        </div>

        {projects.length === 0 && (
          <div className="empty-state">
            <p>the world is empty.</p>
            <p>plant your first project →</p>
          </div>
        )}
      </div>

      <HUD
        scale={camera.scale}
        count={displayProjects.length}
        onRecenter={recenter}
        onAddProject={() => setShowAdd(true)}
        onLogout={onLogout}
      />

      {asOf === null && <WorldSpend />}
      <Scrubber projects={projects ?? []} events={events} asOf={asOf} setAsOf={setAsOf} />
      <Ticker />

      {showAdd && (
        <AddProject
          onClose={() => setShowAdd(false)}
          onCreated={(p) => {
            setProjects((curr) => (curr ? [p, ...curr] : [p]))
            setShowAdd(false)
            setTimeout(() => focusOn(p.slug), 50)
          }}
        />
      )}
    </div>
  )
}
