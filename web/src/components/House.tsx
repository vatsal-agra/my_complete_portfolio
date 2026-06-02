import { memo } from 'react'
import { Interior } from './Interior'
import { relativeTime } from '../lib/time'
import type { ProjectState } from '../lib/types'

// Status palette (per spec §8: tiers are visually distinct, not just colored).
const STATUS_COLOR: Record<ProjectState['status'], string> = {
  thriving: '#2d6a4f',
  active:   '#7fa68e',
  seedling: '#c97b5b',
  dormant:  '#a89b88',
}

// Size scales with vitality.
const STATUS_SIZE: Record<ProjectState['status'], number> = {
  thriving: 32,
  active:   24,
  seedling: 18,
  dormant:  16,
}

const MID_ENTER = 1.8
const INTERIOR_ENTER = 3.2

interface Props {
  project: ProjectState
  x: number
  y: number
  scale: number
  selected: boolean
  anyInterior: boolean
  fresh: boolean
  inverseScale: number
  suppressInterior?: boolean
  onClick: (slug: string) => void
  onClose: () => void
}

function HouseImpl({ project, x, y, scale, selected, anyInterior, fresh, inverseScale, suppressInterior, onClick, onClose }: Props) {
  const size = STATUS_SIZE[project.status]
  const color = STATUS_COLOR[project.status]

  // Interior is suppressed while time-traveling so we don't show "now" data
  // at a past timestamp. Markers/pills still render with derived state.
  const showInterior = selected && scale >= INTERIOR_ENTER && !suppressInterior
  const muted = anyInterior && !selected
  const showMid = !showInterior && !muted && scale >= MID_ENTER

  const baseOpacity = project.status === 'dormant' ? 0.55 : 1
  const markerOpacity = muted ? Math.min(0.25, baseOpacity) : baseOpacity

  return (
    <div
      className={`house tier-${project.status}${selected ? ' selected' : ''}${showInterior ? ' interior-mode' : ''}${muted ? ' muted' : ''}${fresh ? ' fresh' : ''}`}
      style={{ transform: `translate(${x}px, ${y}px) scale(${inverseScale})` }}
      onClick={(e) => { e.stopPropagation(); onClick(project.slug) }}
      role="button"
      tabIndex={0}
      aria-label={`${project.name} — ${project.status}`}
    >
      {!showInterior && (
        <>
          {/* Thriving: outer halo ring */}
          {project.status === 'thriving' && (
            <div
              className="house-halo"
              style={{
                width: size * 2.4,
                height: size * 2.4,
                left: -size * 1.2,
                top: -size * 1.2,
                background: `radial-gradient(circle, ${color}33 0%, ${color}00 70%)`,
              }}
            />
          )}
          {/* Seedling: thin outer ring (suggests sapling/construction plot) */}
          {project.status === 'seedling' && (
            <div
              className="house-ring"
              style={{
                width: size * 1.9,
                height: size * 1.9,
                left: -size * 0.95,
                top: -size * 0.95,
                borderColor: color + '88',
              }}
            />
          )}
          {/* Dormant: dashed faded ring (suggests overgrowth/abandonment) */}
          {project.status === 'dormant' && (
            <div
              className="house-ring dashed"
              style={{
                width: size * 1.8,
                height: size * 1.8,
                left: -size * 0.9,
                top: -size * 0.9,
                borderColor: '#a89b8855',
              }}
            />
          )}
          <div
            className="house-marker"
            style={{
              width: size,
              height: size,
              background: color,
              opacity: markerOpacity,
              left: -size / 2,
              top: -size / 2,
            }}
          />
        </>
      )}

      {!showInterior && !showMid && !muted && (
        <div className="house-label" style={{ top: size / 2 + 6 }}>
          {project.name}
        </div>
      )}

      {showMid && (
        <div className="house-pill" style={{ top: size / 2 + 10 }}>
          <div className="pill-name">{project.name}</div>
          {project.next_step && (
            <div className="pill-next">→ {project.next_step}</div>
          )}
          <div className="pill-meta">
            <span>{project.status}</span>
            <span className="dot">·</span>
            <span>{relativeTime(project.last_activity_ts)}</span>
          </div>
        </div>
      )}

      {showInterior && (
        <Interior project={project} onClose={onClose} />
      )}
    </div>
  )
}

export const House = memo(HouseImpl)
export { MID_ENTER, INTERIOR_ENTER }
