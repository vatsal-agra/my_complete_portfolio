import { clearToken } from '../lib/auth'

interface Props {
  scale: number
  count: number
  onRecenter: () => void
  onAddProject: () => void
  onLogout: () => void
}

export function HUD({ scale, count, onRecenter, onAddProject, onLogout }: Props) {
  return (
    <>
      <div className="hud hud-tl">
        <span className="hud-label">project world</span>
        <span className="hud-meta">{count} projects · zoom {scale.toFixed(2)}×</span>
      </div>
      <div className="hud hud-tr">
        <button onClick={onAddProject} title="Plant a new project (n)">+ new</button>
        <button onClick={onRecenter} title="Recenter (r)">recenter</button>
        <button
          onClick={() => { clearToken(); onLogout() }}
          title="Forget owner token"
          className="ghost"
        >sign out</button>
      </div>
    </>
  )
}
