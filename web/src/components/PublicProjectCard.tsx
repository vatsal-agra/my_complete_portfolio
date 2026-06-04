/**
 * PublicProjectCard — the read-only dossier shown when a visitor clicks a spire
 * in the public world. Sanitized data only (no spend, no private metrics): goal,
 * tech, status, links, and a recent-activity feed from the /public/* endpoints.
 */
import { useEffect, useState } from 'react'
import { publicApi } from '../lib/api'
import { relativeTime, formatTimestamp } from '../lib/time'
import type { PublicProjectDetail, PublicEvent } from '../lib/types'

const EVENT_GLYPH: Record<string, string> = {
  progress: '·', decision: '✦', blocker: '!', next_step: '→',
  milestone: '★', metric: '◇', status_change: '⇌',
  github_commit: '⌘', github_deploy: '↑', note: '✎',
}

export function PublicProjectCard({ slug, locked = false, onClose }: { slug: string; locked?: boolean; onClose: () => void }) {
  const [detail, setDetail] = useState<PublicProjectDetail | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (locked) return  // locked towers expose nothing — never fetch.
    let cancelled = false
    setDetail(null); setErr(null)
    publicApi.project(slug)
      .then((d) => { if (!cancelled) setDetail(d) })
      .catch((e) => { if (!cancelled) setErr(e?.message ?? 'load failed') })
    return () => { cancelled = true }
  }, [slug, locked])

  if (locked) {
    return (
      <div className="pcard pcard-locked" onClick={(e) => e.stopPropagation()}>
        <button className="pcard-close" onClick={onClose} aria-label="close">esc</button>
        <div className="pcard-lock-icon">🔒</div>
        <h2 className="pcard-name">Private project</h2>
        <p className="pcard-goal">This one's a private repository — it's on the map, but its details are kept private.</p>
      </div>
    )
  }

  const p = detail?.project

  return (
    <div className="pcard" onClick={(e) => e.stopPropagation()}>
      <button className="pcard-close" onClick={onClose} aria-label="close">esc</button>

      {!detail && !err && <div className="pcard-loading">opening project…</div>}
      {err && <div className="pcard-error">could not load: {err}</div>}

      {p && (
        <>
          <div className="pcard-head">
            <h2 className="pcard-name">{p.name}</h2>
            <div className="pcard-sub">
              <span className={`pcard-status pcard-status-${p.status}`}>{p.status}</span>
              <span className="pcard-dot">·</span>
              <span>{p.category}</span>
              <span className="pcard-dot">·</span>
              <span>{p.stage}</span>
            </div>
          </div>

          {p.goal && <p className="pcard-goal">{p.goal}</p>}

          {(p.repo || p.live_url) && (
            <div className="pcard-links">
              {p.repo && (
                <a href={`https://github.com/${p.repo}`} target="_blank" rel="noreferrer" className="pcard-link">
                  ⌘ {p.repo}
                </a>
              )}
              {p.live_url && (
                <a href={p.live_url} target="_blank" rel="noreferrer" className="pcard-link pcard-link-live">
                  ↗ live site
                </a>
              )}
            </div>
          )}

          {p.tech_stack.length > 0 && (
            <div className="pcard-chips">
              {p.tech_stack.map((t) => <span key={t} className="pcard-chip">{t}</span>)}
            </div>
          )}

          <div className="pcard-stats">
            <Stat value={p.commits_30d} label="commits / 30d" />
            <Stat value={p.code_bytes ? `${Math.round(p.code_bytes / 1024)} KB` : '—'} label="code size" />
            <Stat value={relativeTime(p.last_activity_ts)} label="last active" />
          </div>

          <div className="pcard-activity">
            <div className="pcard-activity-head">recent activity</div>
            {detail!.events.length === 0 && <div className="pcard-empty">no public activity yet</div>}
            <ol className="pcard-timeline">
              {detail!.events.slice(0, 24).map((e: PublicEvent) => (
                <li key={e.id} className="pcard-tl-row">
                  <span className="pcard-tl-glyph">{EVENT_GLYPH[e.type] ?? '·'}</span>
                  <span className="pcard-tl-body">
                    <span className="pcard-tl-summary">{e.summary}</span>
                    <span className="pcard-tl-ts">{formatTimestamp(e.ts)}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </>
      )}
    </div>
  )
}

function Stat({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="pcard-stat">
      <div className="pcard-stat-value">{value}</div>
      <div className="pcard-stat-label">{label}</div>
    </div>
  )
}
