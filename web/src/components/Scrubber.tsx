import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { ecosystemStart } from '../lib/derive'
import type { ProjectEvent, ProjectState } from '../lib/types'

interface Props {
  projects: ProjectState[]
  events: ProjectEvent[]
  asOf: number | null
  setAsOf: (t: number | null) => void
}

const PLAY_DURATION_MS = 28_000

export function Scrubber({ projects, events, asOf, setAsOf }: Props) {
  const [playing, setPlaying] = useState(false)
  const playStartRef = useRef<{ wallStart: number; rangeStart: number } | null>(null)
  const rafRef = useRef<number | null>(null)

  // Lower bound = the moment the earliest project began existing (counting
  // its earliest event, not just its DB row creation). Memoised because it
  // only changes when projects/events come or go.
  const min = useMemo(() => ecosystemStart(projects, events), [projects, events])
  const max = Date.now()
  const current = asOf ?? max

  const playStop = () => {
    setPlaying(false)
    playStartRef.current = null
    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
  }

  // Play loop: advance asOf from current → max over PLAY_DURATION_MS
  useEffect(() => {
    if (!playing) return
    const start = current
    playStartRef.current = { wallStart: performance.now(), rangeStart: start }
    const tick = (now: number) => {
      const elapsed = now - playStartRef.current!.wallStart
      const total = Math.max(1, max - playStartRef.current!.rangeStart)
      const playFrac = Math.min(1, elapsed / PLAY_DURATION_MS)
      const next = playStartRef.current!.rangeStart + total * playFrac
      if (next >= max) {
        setAsOf(null)
        playStop()
        return
      }
      setAsOf(next)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null } }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing])

  // ESC stops playback
  useEffect(() => {
    if (!playing) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') playStop() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [playing])

  function handleScrub(e: ChangeEvent<HTMLInputElement>) {
    if (playing) playStop()
    const v = parseInt(e.target.value, 10)
    if (Number.isNaN(v) || v >= max) setAsOf(null)
    else setAsOf(v)
  }

  function jumpToNow() {
    if (playing) playStop()
    setAsOf(null)
  }

  const isLive = asOf === null || asOf >= max
  const label = isLive ? 'now' : new Date(current).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  })

  if (events.length === 0 && projects.length === 0) return null

  return (
    <div className="scrubber">
      <button
        type="button"
        onClick={() => (playing ? playStop() : setPlaying(true))}
        className={`scrub-play${playing ? ' on' : ''}`}
        title={playing ? 'pause replay' : 'replay forward in time'}
        aria-label={playing ? 'pause' : 'play'}
      >
        {playing ? '❚❚' : '▷'}
      </button>
      <div className="scrub-track-wrap">
        <input
          type="range"
          min={min}
          max={max}
          value={current}
          step={Math.max(1000, Math.floor((max - min) / 4000))}
          onChange={handleScrub}
          className="scrub-track"
          aria-label="time"
        />
        <div className="scrub-label" style={{ left: `calc(${((current - min) / Math.max(1, max - min)) * 100}% )` }}>
          {label}
        </div>
      </div>
      <button
        type="button"
        onClick={jumpToNow}
        className={`scrub-now${isLive ? ' active' : ''}`}
        title="snap to present"
      >
        now
      </button>
    </div>
  )
}
