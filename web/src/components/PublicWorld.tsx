/**
 * Public, read-only view of the world (PROJECT_SPEC §11).
 *
 * Uses the unauthenticated /public/* endpoints which are backed by anon-key
 * Supabase reads against the sanitized views. No login, no add-project, no
 * portfolio-spend HUD, no interior money section, no time-travel.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useGesture } from '@use-gesture/react'
import { publicApi } from '../lib/api'
import { computePosition } from '../lib/position'
import { relativeTime, formatTimestamp } from '../lib/time'
import type { ProjectState, ProjectEvent, PublicProjectState, PublicProjectDetail } from '../lib/types'

interface Camera { x: number; y: number; scale: number }
const MIN_ZOOM = 0.2
const MAX_ZOOM = 4

function clamp(n: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, n)) }
function easeOutCubic(t: number): number { return 1 - Math.pow(1 - t, 3) }
function lerp(a: number, b: number, t: number): number { return a + (b - a) * t }

const STATUS_COLOR = { thriving: '#2d6a4f', active: '#7fa68e', seedling: '#c97b5b', dormant: '#a89b88' }
const STATUS_SIZE  = { thriving: 32,        active: 24,        seedling: 18,        dormant: 16 }

const EVENT_GLYPH: Record<string, string> = {
  progress: '·', milestone: '★', status_change: '⇌',
  github_commit: '⌘', github_deploy: '↑',
}

// Adapt the public shape to ProjectState (so computePosition just works).
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
  }
}

export function PublicWorld() {
  const [projects, setProjects] = useState<PublicProjectState[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, scale: 1 })
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<PublicProjectDetail | null>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const animRef = useRef<number | null>(null)

  useEffect(() => {
    publicApi.world().then(setProjects).catch((e) => setErr(e?.message ?? 'load failed'))
  }, [])

  useEffect(() => {
    if (projects && projects.length > 0 && viewportRef.current) {
      const w = viewportRef.current.clientWidth
      const h = viewportRef.current.clientHeight
      setCamera({ x: w / 2, y: h / 2, scale: 1 })
    }
  }, [projects?.length])

  useEffect(() => {
    if (!selected) { setDetail(null); return }
    let cancelled = false
    publicApi.project(selected).then((d) => { if (!cancelled) setDetail(d) }).catch(() => {})
    return () => { cancelled = true }
  }, [selected])

  const positioned = useMemo(() => {
    if (!projects) return []
    return projects.map((p) => ({ p, pos: computePosition(asProjectState(p)) }))
  }, [projects])

  const stopAnim = useCallback(() => {
    if (animRef.current !== null) { cancelAnimationFrame(animRef.current); animRef.current = null }
  }, [])

  const animateCamera = useCallback((target: Camera) => {
    stopAnim()
    const start = { ...camera }
    const startTime = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - startTime) / 360)
      const e = easeOutCubic(t)
      setCamera({
        x: lerp(start.x, target.x, e),
        y: lerp(start.y, target.y, e),
        scale: lerp(start.scale, target.scale, e),
      })
      if (t < 1) animRef.current = requestAnimationFrame(tick)
      else animRef.current = null
    }
    animRef.current = requestAnimationFrame(tick)
  }, [camera, stopAnim])

  const bind = useGesture({
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
        const rect = viewportRef.current?.getBoundingClientRect()
        if (!rect) return { ...c, scale: newScale }
        const mx = (event as WheelEvent).clientX - rect.left
        const my = (event as WheelEvent).clientY - rect.top
        const ratio = newScale / c.scale
        return { scale: newScale, x: mx - (mx - c.x) * ratio, y: my - (my - c.y) * ratio }
      })
    },
  }, { wheel: { eventOptions: { passive: false } } })

  const focusOn = useCallback((slug: string) => {
    if (!viewportRef.current || !projects) return
    const p = projects.find((q) => q.slug === slug)
    if (!p) return
    const pos = computePosition(asProjectState(p))
    const w = viewportRef.current.clientWidth
    const h = viewportRef.current.clientHeight
    const targetScale = 2.2
    setSelected(slug)
    animateCamera({ scale: targetScale, x: w / 2 - pos.x * targetScale, y: h / 2 - pos.y * targetScale })
  }, [projects, animateCamera])

  const recenter = useCallback(() => {
    if (!viewportRef.current) return
    const w = viewportRef.current.clientWidth
    const h = viewportRef.current.clientHeight
    setSelected(null)
    animateCamera({ x: w / 2, y: h / 2, scale: 1 })
  }, [animateCamera])

  if (err)        return <div className="full-error">could not load: {err}</div>
  if (!projects)  return <div className="loading">loading…</div>

  return (
    <div className="world-shell public">
      <div ref={viewportRef} className="viewport" {...bind()} onClick={() => setSelected(null)}>
        <div
          className="stage"
          style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})` }}
        >
          {positioned.map(({ p, pos }) => (
            <div
              key={p.slug}
              className={`house tier-${p.status}${selected === p.slug ? ' selected' : ''}`}
              style={{ transform: `translate(${pos.x}px, ${pos.y}px) scale(${1 / Math.max(0.4, camera.scale)})` }}
              onClick={(e) => { e.stopPropagation(); focusOn(p.slug) }}
              role="button"
              aria-label={`${p.name} — ${p.status}`}
            >
              <div
                className="house-marker"
                style={{
                  width: STATUS_SIZE[p.status], height: STATUS_SIZE[p.status],
                  background: STATUS_COLOR[p.status],
                  opacity: p.status === 'dormant' ? 0.6 : 1,
                  left: -STATUS_SIZE[p.status] / 2, top: -STATUS_SIZE[p.status] / 2,
                }}
              />
              <div className="house-label" style={{ top: STATUS_SIZE[p.status] / 2 + 6 }}>{p.name}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="hud hud-tl">
        <span className="hud-label">project world</span>
        <span className="hud-meta">{projects.length} projects · public view</span>
      </div>

      <div className="hud hud-tr">
        <button onClick={recenter} title="recenter (r)">recenter</button>
      </div>

      {selected && detail && (
        <aside className="public-panel" onClick={(e) => e.stopPropagation()}>
          <button className="interior-close" onClick={() => setSelected(null)}>esc</button>
          <h2 className="interior-name">{detail.project.name}</h2>
          <div className="interior-meta">
            <span className="category">{detail.project.category}</span>
            <span className={`status-badge status-${detail.project.status}`}>{detail.project.status}</span>
            {detail.project.repo && (
              <a className="link" href={`https://github.com/${detail.project.repo}`} target="_blank" rel="noreferrer">github</a>
            )}
            {detail.project.live_url && (
              <a className="link" href={detail.project.live_url} target="_blank" rel="noreferrer">live</a>
            )}
            <span className="dim">{relativeTime(detail.project.last_activity_ts)}</span>
          </div>
          {detail.project.goal && (
            <section className="interior-section interior-goal">
              <div className="section-label">north star</div>
              <p>{detail.project.goal}</p>
            </section>
          )}
          {detail.project.tech_stack.length > 0 && (
            <section className="interior-section">
              <div className="section-label">stack</div>
              <div className="chip-row">
                {detail.project.tech_stack.map((t) => <span key={t} className="chip">{t}</span>)}
              </div>
            </section>
          )}
          <section className="interior-section">
            <div className="section-label">activity</div>
            {detail.events.length === 0 ? (
              <p className="dim">no public activity yet.</p>
            ) : (
              <ul className="timeline">
                {detail.events.map((e) => (
                  <li key={e.id} className={`tl-row tl-${e.type}`}>
                    <span className="tl-glyph">{EVENT_GLYPH[e.type] ?? '·'}</span>
                    <span className="tl-summary">{e.summary}</span>
                    <span className="tl-ts">{formatTimestamp(e.ts)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      )}
    </div>
  )
}

// Keep this import to satisfy bundler tree-shaking if needed; the type is used internally.
type _ProjectEvent = ProjectEvent
