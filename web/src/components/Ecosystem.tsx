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
import { api, publicApi } from '../lib/api'
import { buildBranches, type Branch } from '../lib/ecosystem-data'
import { publicDetailToProjectDetail } from '../lib/public-adapt'
import { relativeTime, formatTimestamp } from '../lib/time'
import { STAGE_COLOR } from './House3D'
import type { ProjectDetail, ProjectState, ProjectEvent, ProjectStage } from '../lib/types'

interface Props {
  project: ProjectState
  onClose: () => void
  /** Public (read-only, sanitized) mode — used by the public world. Hides the
   *  stage editor and the spend/metrics branches, and loads via /public/*. */
  isPublic?: boolean
  /** Called after an owner edit (e.g. stage change) so World3D can update the
   *  spire colour live without waiting for the next poll. */
  onUpdated?: (p: ProjectState) => void
}

const STAGES: { key: ProjectStage; label: string }[] = [
  { key: 'idea',     label: 'Idea' },
  { key: 'wip',      label: 'WIP' },
  { key: 'shipped',  label: 'Shipped' },
  { key: 'archived', label: 'Archived' },
]

// SVG geometry. Each branch shows up to 3 leaves stacked straight OUTWARD along
// its spoke (no sideways fan) at these radii. The 120px gap between radii is
// what keeps stacked bubbles from overlapping even on the near-horizontal
// spokes — a smaller gap lets a 210px-wide bubble collide with the next one
// out. Verified collision-free (incl. header↔leaf and core↔leaf) at worst-case
// full width; ext ≈ 599 just inside VB = 600.
const R_HEADER = 205
const R_LEAF_RADII = [330, 450, 570]  // leaf 0, 1, 2 — increasing distance, 120 apart
const VB = 600  // viewBox half-extent

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

export function Ecosystem({ project, onClose, isPublic = false, onUpdated }: Props) {
  const [detail, setDetail] = useState<ProjectDetail | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setDetail(null); setErr(null)
    const load = isPublic
      ? publicApi.project(project.slug).then(publicDetailToProjectDetail)
      : api.project(project.slug)
    load
      .then((d) => { if (!cancelled) setDetail(d) })
      .catch((e) => { if (!cancelled) setErr(e?.message ?? 'load failed') })
    return () => { cancelled = true }
  }, [project.slug, isPublic])

  const branches = useMemo<Branch[]>(() => {
    if (!detail) return []
    // Override the dynamic colors with our cohesive palette.
    let bs = buildBranches(detail).map((b) => ({ ...b, color: BRANCH_COLOR[b.key] ?? b.color }))
    // Public view never shows money/metrics.
    if (isPublic) bs = bs.filter((b) => b.key !== 'spend' && b.key !== 'metrics')
    return bs
  }, [detail, isPublic])

  // Patch the loaded detail in place after an owner edit (e.g. goal) so the
  // mind-map re-renders without a refetch.
  const patchDetail = (p: Partial<ProjectState>) =>
    setDetail((d) => (d ? { ...d, project: { ...d.project, ...p } } : d))

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
        <StatsDashboard detail={detail} project={project} isPublic={isPublic} onUpdated={onUpdated} onGoalSaved={patchDetail} />
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

function StageEditor({ project, onUpdated }: { project: ProjectState; onUpdated?: (p: ProjectState) => void }) {
  const [stage, setStage] = useState<ProjectStage>(project.stage)
  const [saving, setSaving] = useState<ProjectStage | null>(null)
  const [err, setErr] = useState(false)

  // Keep in sync if the project prop changes (e.g. a poll refresh).
  useEffect(() => { setStage(project.stage) }, [project.stage])

  const choose = async (next: ProjectStage) => {
    if (next === stage || saving) return
    setSaving(next); setErr(false)
    const prev = stage
    setStage(next)  // optimistic
    try {
      const updated = await api.patchProject(project.slug, { stage: next })
      onUpdated?.(updated)
    } catch {
      setStage(prev); setErr(true)  // revert on failure
    } finally {
      setSaving(null)
    }
  }

  return (
    <div className="eco-stat-block">
      <div className="eco-stat-block-label">stage{err ? ' · save failed' : ''}</div>
      <div className="eco-stage-row">
        {STAGES.map((s) => {
          const active = s.key === stage
          const color = STAGE_COLOR[s.key]
          return (
            <button
              key={s.key}
              className={`eco-stage-btn${active ? ' active' : ''}`}
              style={active ? { background: color, borderColor: color, color: '#11131f' } : { borderColor: color, color }}
              onClick={() => void choose(s.key)}
              disabled={saving !== null}
            >
              {saving === s.key ? '…' : s.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Owner-editable north-star goal. Auto-fills from GitHub when left empty, but
 *  the owner can always override it here. */
function GoalEditor({
  project, currentGoal, onUpdated, onGoalSaved,
}: {
  project: ProjectState
  currentGoal: string | null
  onUpdated?: (p: ProjectState) => void
  onGoalSaved: (p: Partial<ProjectState>) => void
}) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(currentGoal ?? '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(false)

  // Sync local draft when the project's goal changes underneath us.
  useEffect(() => { if (!editing) setText(currentGoal ?? '') }, [currentGoal, editing])

  const save = async () => {
    const next = text.trim()
    if (next === (currentGoal ?? '').trim()) { setEditing(false); return }
    setSaving(true); setErr(false)
    try {
      const updated = await api.patchProject(project.slug, { goal: next })
      onGoalSaved({ goal: next || null })
      onUpdated?.(updated)
      setEditing(false)
    } catch {
      setErr(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="eco-stat-block">
      <div className="eco-stat-block-label">goal{err ? ' · save failed' : ''}</div>
      {editing ? (
        <div className="eco-goal-edit">
          <textarea
            className="eco-goal-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="the project's north star…"
            autoFocus
          />
          <div className="eco-goal-actions">
            <button className="eco-goal-btn" onClick={() => { setEditing(false); setText(currentGoal ?? '') }} disabled={saving}>cancel</button>
            <button className="eco-goal-btn primary" onClick={() => void save()} disabled={saving}>{saving ? 'saving…' : 'save'}</button>
          </div>
        </div>
      ) : (
        <div className="eco-goal-view">
          <p className="eco-goal-text">{currentGoal?.trim() || <span className="dim">— no goal set (auto-fills from GitHub) —</span>}</p>
          <button className="eco-goal-btn" onClick={() => setEditing(true)}>edit</button>
        </div>
      )}
    </div>
  )
}

function StatsDashboard({ detail, project, isPublic = false, onUpdated, onGoalSaved }: { detail: ProjectDetail | null; project: ProjectState; isPublic?: boolean; onUpdated?: (p: ProjectState) => void; onGoalSaved: (p: Partial<ProjectState>) => void }) {
  if (!detail) {
    return (
      <>
        <div className="eco-side-head">
          <div className="eco-side-label">vitals</div>
          <RepoLink repo={project.repo} />
        </div>
        {!isPublic && <StageEditor project={project} onUpdated={onUpdated} />}
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
        <RepoLink repo={project.repo} />
      </div>

      {!isPublic && <StageEditor project={project} onUpdated={onUpdated} />}

      {isPublic
        ? (detail.project.goal && (
            <div className="eco-stat-block">
              <div className="eco-stat-block-label">goal</div>
              <p className="eco-goal-readonly">{detail.project.goal}</p>
            </div>
          ))
        : (
          <GoalEditor
            project={project}
            currentGoal={detail.project.goal}
            onUpdated={onUpdated}
            onGoalSaved={onGoalSaved}
          />
        )}

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

/** GitHub link for the project screen. Falls back to a muted "no repo" label
 *  when the project has no linked repository. */
function RepoLink({ repo }: { repo: string | null }) {
  if (!repo) return <div className="eco-side-sub dim">no repo</div>
  return (
    <a
      className="eco-repo-link"
      href={`https://github.com/${repo}`}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      title={`open ${repo} on GitHub`}
    >
      <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden fill="currentColor">
        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
      </svg>
      <span>{repo}</span>
    </a>
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

function leafPos(branchAngle: number, leafIndex: number, _leafCount: number): { x: number; y: number } {
  // Leaves stack straight out along the branch spoke (no sideways fan): each
  // successive leaf sits one radius farther out, so they separate radially
  // instead of colliding. (buildBranches caps each branch at 3 leaves.)
  const r = R_LEAF_RADII[Math.min(leafIndex, R_LEAF_RADII.length - 1)]!
  return polar(branchAngle, r)
}

function leafWidth(text: string): number {
  return Math.max(100, Math.min(210, text.length * 8.4 + 20))
}
