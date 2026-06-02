/**
 * Legend — small top-right key explaining how the world reads:
 *   distance = recency, height = volume, hue = lifecycle stage.
 *
 * Sits below the HUD action buttons. Collapsible (click the header) so it
 * doesn't crowd the viewport once the user has internalised the encoding.
 */
import { useState } from 'react'
import { STAGE_COLOR } from './House3D'

const STAGES: { key: keyof typeof STAGE_COLOR; label: string; hint: string }[] = [
  { key: 'idea',     label: 'idea',     hint: 'concept, no code yet' },
  { key: 'wip',      label: 'wip',      hint: 'actively building' },
  { key: 'shipped',  label: 'shipped',  hint: 'live in the wild' },
  { key: 'archived', label: 'archived', hint: 'finished, kept as memory' },
]

export function Legend() {
  const [open, setOpen] = useState(true)

  return (
    <div className={`legend${open ? '' : ' collapsed'}`}>
      <button
        type="button"
        className="legend-head"
        onClick={() => setOpen((o) => !o)}
        title={open ? 'Hide legend' : 'Show legend'}
      >
        <span>legend</span>
        <span className="legend-chev">{open ? '–' : '+'}</span>
      </button>

      {open && (
        <div className="legend-body">
          <div className="legend-row">
            <span className="legend-key">distance</span>
            <span className="legend-val">recency — closer = touched more recently</span>
          </div>
          <div className="legend-row">
            <span className="legend-key">height</span>
            <span className="legend-val">activity volume — taller = more commits & events</span>
          </div>
          <div className="legend-row">
            <span className="legend-key">glow / beam</span>
            <span className="legend-val">alive right now — beam = touched in last 2 weeks</span>
          </div>

          <div className="legend-sep" />

          <div className="legend-row legend-row-stage">
            <span className="legend-key">colour</span>
            <span className="legend-val">lifecycle stage</span>
          </div>
          <ul className="legend-stages">
            {STAGES.map((s) => (
              <li key={s.key}>
                <span className="legend-dot" style={{ background: STAGE_COLOR[s.key], boxShadow: `0 0 8px ${STAGE_COLOR[s.key]}` }} />
                <span className="legend-stage-label">{s.label}</span>
                <span className="legend-stage-hint">{s.hint}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
