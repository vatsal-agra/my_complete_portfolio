import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { relativeTime } from '../lib/time'
import type { RecentEvent } from '../lib/types'

const EVENT_GLYPH: Record<string, string> = {
  progress: '·',     decision: '✦',  blocker: '!',     spend: '$',
  next_step: '→',    milestone: '★', metric: '◇',      status_change: '⇌',
  github_commit: '⌘', github_deploy: '↑', note: '✎',
}

export function Ticker() {
  const [events, setEvents] = useState<RecentEvent[]>([])
  const railRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    function load() {
      api.recentEvents(25).then((d) => { if (!cancelled) setEvents(d) }).catch(() => {})
    }
    load()
    const id = setInterval(load, 12_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  if (events.length === 0) return null

  // Double the list so the CSS marquee can loop seamlessly.
  const doubled = [...events, ...events]

  return (
    <div className="ticker">
      <div className="ticker-rail" ref={railRef}>
        {doubled.map((e, i) => (
          <span key={`${e.id}-${i}`} className="ticker-item">
            <span className="ticker-glyph">{EVENT_GLYPH[e.type] ?? '·'}</span>
            <span className="ticker-project">{e.projects?.name ?? '?'}</span>
            <span className="ticker-sep">·</span>
            <span className="ticker-summary">{e.summary}</span>
            <span className="ticker-time">{relativeTime(e.ts)}</span>
          </span>
        ))}
      </div>
    </div>
  )
}
