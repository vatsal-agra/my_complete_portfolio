/**
 * Ecosystem — the multi-screen holographic interface that unfurls when a
 * project is selected. Three panels:
 *
 *   ┌─────────┐  ┌───────────────┐  ┌─────────┐
 *   │ activity│  │   mind-map    │  │  stats  │
 *   │ timeline│  │  (6 branches  │  │  vitals │
 *   │         │  │   around core)│  │         │
 *   └─────────┘  └───────────────┘  └─────────┘
 *
 * Mind-map emerges from the spire's cap with a slow expanding animation;
 * the side panels slide in from their edges, staggered, so the whole
 * interface assembles around the project over ~2.4 seconds.
 *
 * Palette is intentionally cohesive — all branches sit in the warm
 * amber/cream/terracotta family so the interface reads as a single dossier
 * rather than a Trapper Keeper.
 */
import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import { buildBranches, type Branch } from '../lib/ecosystem-data'
import { relativeTime, formatTimestamp } from '../lib/time'
import type { ProjectDetail, ProjectState, ProjectEvent } from '../lib/types'

interface Props {
  project: ProjectState
  onClose: () => void
}

// SVG geometry. Bumped up so headers, leaves, and the core all render large.
const R_HEADER = 205
const R_LEAF_NEAR = 305
const R_LEAF_FAR = 380
const VB = 510  // viewBox half-extent

// Six fixed angles (radians, 0 = +x, counter-clockwise) at 60° intervals.
const BRANCH_ANGLES: Record<string, number> = {
  goal:    Math.PI / 2,
  latest:  Math.PI / 6,
  stack:  -Math.PI / 6,
  langs:  -Math.PI / 2,
  metrics:-5 * Math.PI / 6,
  spend:   5 * Math.PI / 6,
}

// Refined palette: all warm, all in the same value range, no candy pastels.
const BRANCH_COLOR: Record<string, string> = {
  goal:    '#ffd9a0',   // pure amber — the north star
  latest:  '#e8b08c',   // warm peach — fresh activity
  stack:   '#d4b87a',   // dusty gold — tools
  langs:   '#c97b5b',   // terracotta — code roots
  metrics: '#e8c98a',   // cream gold — data
  spend:   '#b88560',   // deep amber — money
}

const EVENT_GLYPH: Record<string, string> = {
  progress:      '·',
  decision:      '✦',
  blocker:       '!',
  spend:         '$',
  next_step:     '→',
  milestone:     '★',
  metric:        '◇',
  status_change: '⇌',
  github_commit: '⌘',
  github_deploy: '↑',
  note:          '✎',
}

function polar(angle: number, r: number): { x: number; y: number } {
  return { x: Math.cos(angle) * r, y: -Math.sin(angle) * r }
}

export function Ecosystem({ project, onClose }: Props) {
  const [detail, setDetail] = useState<ProjectDetail | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setDetail(null); setErr(null)
    api.project(project.slug)
      .then((d) => { if (!cancelled) setDetail(d) })
      .catch((e) => { if (!cancelled) setErr(e?.message ?? 'load failed') })
    return () => { cancelled = true }
  }, [project.slug])

  const branches = useMemo<Branch[]>(() => {
    if (!detail) return []
    // Override the dynamic colors with our cohesive palette.
    return buildBranches(detail).map((b) => ({ ...b, color: BRANCH_COLOR[b.key] ?? b.color }))
  }, [detail])

  return (
    <div className="eco-shell" onClick={(e) => e.stopPropagation()}>
      <button className="ecosystem-close" onClick={onClose} aria-label="close">esc</button>

      {/* LEFT — activity timeline */}
      <aside className="eco-side eco-left">
        <ActivityTimeline detail={detail} err={err} />
      </aside>

      {/* CENTER — radial mind-map */}
      <div className="ecosystem">
        {err && <div className="ecosystem-error">could not load: {err}</div>}
        {!detail && !err && <div className="ecosystem-loading">opening project…</div>}

        {detail && (
          <svg
            className="ecosystem-svg"
            viewBox={`${-VB} ${-VB} ${VB * 2} ${VB * 2}`}
            width="100%"
            height="100%"
            preserveAspectRatio="xMidYMid meet"
          >
            <defs>
              <radialGradient id="core-grad" cx="50%" cy="50%" r="50%">
                <stop offset="0%"  stopColor="#1f2440" stopOpacity={0.96} />
                <stop offset="75%" stopColor="#0e1023" stopOpacity={0.92} />
                <stop offset="100%" stopColor="#0e1023" stopOpacity={0.0}  />
              </radialGradient>
              <filter id="soft-glow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {/* Lines: core → branch headers */}
            {branches.map((b) => {
              const angle = BRANCH_ANGLES[b.key]!
              const head = polar(angle, R_HEADER)
              return (
                <line
                  key={`line-${b.key}`}
                  x1={Math.cos(angle) * 86}
                  y1={-Math.sin(angle) * 86}
                  x2={head.x} y2={head.y}
                  stroke={b.color}
                  strokeOpacity={0.6}
                  strokeWidth={1.8}
                  strokeDasharray="4 6"
                />
              )
            })}

            {/* Lines: header → leaves */}
            {branches.map((b) => {
              const angle = BRANCH_ANGLES[b.key]!
              const head = polar(angle, R_HEADER)
              return b.items.map((_, i) => {
                const pos = leafPos(angle, i, b.items.length)
                return (
                  <line
                    key={`leafline-${b.key}-${i}`}
                    x1={head.x} y1={head.y}
                    x2={pos.x} y2={pos.y}
                    stroke={b.color}
                    strokeOpacity={0.45}
                    strokeWidth={1.2}
                  />
                )
              })
            })}

            {/* Leaves */}
            {branches.map((b) => {
              const angle = BRANCH_ANGLES[b.key]!
              return b.items.map((item, i) => {
                const pos = leafPos(angle, i, b.items.length)
                const w = leafWidth(item)
                return (
                  <g key={`leaf-${b.key}-${i}`} className="leaf">
                    <ellipse
                      cx={pos.x} cy={pos.y}
                      rx={w / 2} ry={24}
                      fill={b.color} fillOpacity={0.14}
                      stroke={b.color} strokeOpacity={0.75} strokeWidth={1.2}
                    />
                    <text
                      x={pos.x} y={pos.y + 6}
                      textAnchor="middle"
                      fontSize={16}
                      fill="#f4f0e3"
                      fontFamily="ui-serif, Iowan Old Style, Georgia, serif"
                    >{item}</text>
                  </g>
                )
              })
            })}

            {/* Branch headers */}
            {branches.map((b) => {
              const angle = BRANCH_ANGLES[b.key]!
              const pos = polar(angle, R_HEADER)
              return (
                <g key={`hdr-${b.key}`} transform={`translate(${pos.x} ${pos.y})`}>
                  <rect
                    x={-68} y={-22} width={136} height={44} rx={9}
                    fill={b.color} fillOpacity={0.92}
                    stroke={b.color} strokeOpacity={1} strokeWidth={1.6}
                  />
                  <text
                    x={0} y={8}
                    textAnchor="middle"
                    fontSize={17}
                    letterSpacing={2}
                    fontWeight={700}
                    fill="#0e1023"
                    fontFamily="ui-monospace, monospace"
                  >{b.label.toUpperCase()}</text>
                  {b.subtitle && (
                    <text
                      x={0} y={40}
                      textAnchor="middle"
                      fontSize={13}
                      fill={b.color}
                      fillOpacity={0.88}
                      fontFamily="ui-monospace, monospace"
                      letterSpacing={0.6}
                    >{b.subtitle}</text>
                  )}
                </g>
              )
            })}

            {/* Central core */}
            <g className="core" filter="url(#soft-glow)">
              <circle cx={0} cy={0} r={100}
                fill="url(#core-grad)" stroke="#ffd9a0" strokeOpacity={0.55} strokeWidth={1.8} />
              <circle cx={0} cy={0} r={108}
                fill="none" stroke="#ffd9a0" strokeOpacity={0.2} strokeWidth={1.2} strokeDasharray="3 6" />
              <text x={0} y={-12} textAnchor="middle"
                fontSize={Math.min(30, 340 / Math.max(detail.project.name.length, 6))}
                fontWeight={500}
                fill="#f7f3e6"
                fontFamily="ui-serif, Iowan Old Style, Georgia, serif"
              >{detail.project.name}</text>
              <text x={0} y={16} textAnchor="middle"
                fontSize={14}
                letterSpacing={2}
                fontWeight={600}
                fill="#ffd9a0"
                fontFamily="ui-monospace, monospace"
              >{detail.project.status.toUpperCase()}</text>
              <text x={0} y={44} textAnchor="middle"
                fontSize={13}
                fill="#b4b0a3"
                fontFamily="ui-monospace, monospace"
              >{detail.project.category} · {relativeTime(detail.project.last_activity_ts)}</text>
            </g>
          </svg>
        )}
      </div>

      {/* RIGHT — vitals / stats */}
      <aside className="eco-side eco-right">
        <StatsDashboard detail={detail} project={project} />
      </aside>
    </div>
  )
}

/* ----------------------------- Side panels ----------------------------- */

function ActivityTimeline({ detail, err }: { detail: ProjectDetail | null; err: string | null }) {
  return (
    <>
      <div className="eco-side-head">
        <div className="eco-side-label">activity log</div>
        <div className="eco-side-sub">{detail ? `${detail.events.length} events` : '…'}</div>
      </div>
      {err && <div className="eco-side-empty">could not load</div>}
      {!detail && !err && <div className="eco-side-empty">scanning…</div>}
      {detail && (
        <ol className="eco-timeline">
          {detail.events.slice(0, 40).map((e: ProjectEvent) => (
            <li key={e.id} className={`eco-tl-row eco-tl-${e.type}`}>
              <span className="eco-tl-glyph">{EVENT_GLYPH[e.type] ?? '·'}</span>
              <span className="eco-tl-body">
                <span className="eco-tl-summary">{e.summary}</span>
                <span className="eco-tl-meta">
                  <span className="eco-tl-type">{e.type}</span>
                  <span className="eco-tl-ts">{formatTimestamp(e.ts)}</span>
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </>
  )
}

function StatsDashboard({ detail, project }: { detail: ProjectDetail | null; project: ProjectState }) {
  if (!detail) {
    return (
      <>
        <div className="eco-side-head">
          <div className="eco-side-label">vitals</div>
        </div>
        <div className="eco-side-empty">scanning…</div>
      </>
    )
  }

  const allCommits = detail.events.filter((e) => e.type === 'github_commit').length
  const lastNow = detail.project.last_activity_ts
    ? Math.max(0, Math.round((Date.now() - Date.parse(detail.project.last_activity_ts)) / 86400000))
    : null
  const daysAlive = Math.max(1, Math.round((Date.now() - Date.parse(detail.project.created_at)) / 86400000))

  const spendTotals = Object.entries(detail.spend_summary.by_currency)
  const spendByCat = Object.entries(detail.spend_summary.by_category).sort((a, b) => b[1] - a[1])
  const spendMax = spendByCat[0]?.[1] ?? 1

  return (
    <>
      <div className="eco-side-head">
        <div className="eco-side-label">vitals</div>
        <div className="eco-side-sub">{project.repo ?? 'no repo'}</div>
      </div>

      <div className="eco-stat-grid">
        <BigStat value={allCommits} label="commits" />
        <BigStat value={detail.project.commits_30d} label="last 30d" />
        <BigStat value={lastNow ?? '—'} label="days since" />
        <BigStat value={daysAlive} label="days alive" />
      </div>

      {detail.metrics.length > 0 && (
        <div className="eco-stat-block">
          <div className="eco-stat-block-label">metrics</div>
          {detail.metrics.slice(0, 4).map((m) => (
            <div key={`${m.project_id}-${m.name}`} className="eco-metric-row">
              <span className="eco-metric-name">{m.name}</span>
              <span className="eco-metric-value">{fmtVal(m.value)}{m.unit ? ' ' + m.unit : ''}</span>
            </div>
          ))}
        </div>
      )}

      {spendTotals.length > 0 && (
        <div className="eco-stat-block">
          <div className="eco-stat-block-label">spend</div>
          <div className="eco-spend-totals">
            {spendTotals.map(([cur, amt]) => (
              <div key={cur} className="eco-spend-total">
                <span className="eco-spend-amt">{fmtMoney(amt)}</span>
                <span className="eco-spend-cur">{cur}</span>
              </div>
            ))}
          </div>
          {spendByCat.length > 0 && (
            <div className="eco-spend-bars">
              {spendByCat.slice(0, 5).map(([cat, amt]) => (
                <div key={cat} className="eco-bar">
                  <div className="eco-bar-row">
                    <span className="eco-bar-name">{cat}</span>
                    <span className="eco-bar-amt">{fmtMoney(amt)}</span>
                  </div>
                  <div className="eco-bar-track">
                    <div
                      className="eco-bar-fill"
                      style={{ width: `${(amt / spendMax) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {detail.project.tech_stack.length > 0 && (
        <div className="eco-stat-block">
          <div className="eco-stat-block-label">tech</div>
          <div className="eco-chips">
            {detail.project.tech_stack.map((t) => <span key={t} className="eco-chip">{t}</span>)}
          </div>
        </div>
      )}
    </>
  )
}

function BigStat({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="eco-stat">
      <div className="eco-stat-value">{value}</div>
      <div className="eco-stat-label">{label}</div>
    </div>
  )
}

function fmtMoney(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
}
function fmtVal(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'number') return v.toLocaleString(undefined, { maximumFractionDigits: 2 })
  if (typeof v === 'boolean') return v ? 'yes' : 'no'
  if (typeof v === 'string') return v
  return JSON.stringify(v)
}

function leafPos(branchAngle: number, leafIndex: number, leafCount: number): { x: number; y: number } {
  const SPREAD = 0.36
  const t = leafCount === 1 ? 0 : (leafIndex - (leafCount - 1) / 2) / ((leafCount - 1) / 2)
  const a = branchAngle + t * SPREAD
  const r = leafCount > 3 && leafIndex % 2 === 1 ? R_LEAF_FAR : R_LEAF_NEAR
  return polar(a, r)
}

function leafWidth(text: string): number {
  return Math.max(110, Math.min(280, text.length * 9.2 + 24))
}
