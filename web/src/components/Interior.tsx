import { useEffect, useState, memo } from 'react'
import { api } from '../lib/api'
import { relativeTime, formatTimestamp } from '../lib/time'
import type { ProjectDetail, ProjectEvent, ProjectState } from '../lib/types'

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

interface Props {
  project: ProjectState
  onClose: () => void
}

function InteriorImpl({ project, onClose }: Props) {
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

  return (
    <div className="interior" onClick={(e) => e.stopPropagation()}>
      <header className="interior-head">
        <div className="interior-head-row">
          <h2 className="interior-name">{project.name}</h2>
          <span className={`status-badge status-${project.status}`}>{project.status}</span>
        </div>
        <div className="interior-meta">
          <span className="category">{project.category}</span>
          {project.repo && (
            <a href={`https://github.com/${project.repo}`} target="_blank" rel="noreferrer" className="link">
              github · {project.repo}
            </a>
          )}
          {project.live_url && (
            <a href={project.live_url} target="_blank" rel="noreferrer" className="link">live</a>
          )}
          <span className="dim">{relativeTime(project.last_activity_ts)}</span>
        </div>
        {detail?.current_state && (
          <p className="interior-current-state">{detail.current_state}</p>
        )}
      </header>

      {err && <div className="interior-error">{err}</div>}

      {!detail && !err && <div className="interior-loading">loading…</div>}

      {detail && (
        <>
          {project.goal && (
            <section className="interior-section interior-goal">
              <div className="section-label">north star</div>
              <p>{project.goal}</p>
            </section>
          )}

          {project.next_step && (
            <section className="interior-section interior-next">
              <div className="section-label">next step</div>
              <p>→ {project.next_step}</p>
            </section>
          )}

          {detail.metrics.length > 0 && (
            <section className="interior-section">
              <div className="section-label">metrics</div>
              <div className="metric-grid">
                {detail.metrics.map((m) => (
                  <div key={`${m.project_id}-${m.name}`} className="metric-card">
                    <div className="metric-name">{m.name}</div>
                    <div className="metric-value">
                      <span className="metric-num">{formatMetricValue(m.value)}</span>
                      {m.unit && <span className="metric-unit">{m.unit}</span>}
                    </div>
                    <div className="metric-age">{relativeTime(m.as_of)}</div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {project.tech_stack.length > 0 && (
            <section className="interior-section">
              <div className="section-label">stack</div>
              <div className="chip-row">
                {project.tech_stack.map((t) => <span key={t} className="chip">{t}</span>)}
              </div>
            </section>
          )}

          <SpendBlock detail={detail} />

          <BlockersBlock events={detail.events} />

          <section className="interior-section">
            <div className="section-label">timeline</div>
            {detail.events.length === 0 ? (
              <p className="dim">no events yet — push one to bring this project to life.</p>
            ) : (
              <ul className="timeline">
                {detail.events.map((e) => (
                  <li key={e.id} className={`tl-row tl-${e.type}`}>
                    <span className="tl-glyph" title={e.type}>{EVENT_GLYPH[e.type] ?? '·'}</span>
                    <span className="tl-summary">{e.summary}</span>
                    <span className="tl-ts">{formatTimestamp(e.ts)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      <button className="interior-close" onClick={onClose} aria-label="close">esc</button>
    </div>
  )
}

function SpendBlock({ detail }: { detail: ProjectDetail }) {
  const totals = Object.entries(detail.spend_summary.by_currency)
  if (totals.length === 0) return null
  const cats = Object.entries(detail.spend_summary.by_category).sort((a, b) => b[1] - a[1])
  const vendors = Object.entries(detail.spend_summary.by_vendor).sort((a, b) => b[1] - a[1])
  return (
    <section className="interior-section">
      <div className="section-label">spend</div>
      <div className="spend-totals">
        {totals.map(([cur, amt]) => (
          <div key={cur} className="spend-total">
            <span className="spend-amt">{formatMoney(amt)}</span>
            <span className="spend-cur">{cur}</span>
          </div>
        ))}
      </div>
      <div className="spend-breakdown">
        {cats.length > 0 && (
          <div className="spend-col">
            <div className="spend-col-label">by category</div>
            {cats.map(([c, amt]) => (
              <div key={c} className="spend-row">
                <span className="spend-row-name">{c}</span>
                <span className="spend-row-amt">{formatMoney(amt)}</span>
              </div>
            ))}
          </div>
        )}
        {vendors.length > 0 && (
          <div className="spend-col">
            <div className="spend-col-label">by vendor</div>
            {vendors.map(([v, amt]) => (
              <div key={v} className="spend-row">
                <span className="spend-row-name">{v}</span>
                <span className="spend-row-amt">{formatMoney(amt)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function BlockersBlock({ events }: { events: ProjectEvent[] }) {
  const blockers = events.filter((e) => e.type === 'blocker').slice(0, 6)
  if (blockers.length === 0) return null
  return (
    <section className="interior-section interior-blockers">
      <div className="section-label">blockers</div>
      <ul className="blocker-list">
        {blockers.map((b) => (
          <li key={b.id}>
            <span className="bullet">!</span>
            <span>{b.summary}</span>
            <span className="dim">{relativeTime(b.ts)}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function formatMetricValue(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'number') return v.toLocaleString(undefined, { maximumFractionDigits: 2 })
  if (typeof v === 'boolean') return v ? 'yes' : 'no'
  if (typeof v === 'string') return v
  return JSON.stringify(v)
}

function formatMoney(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export const Interior = memo(InteriorImpl)
