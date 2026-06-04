import { useState } from 'react'
import { api } from '../lib/api'
import { clearToken } from '../lib/auth'

interface Props {
  scale: number
  count: number
  onRecenter: () => void
  onAddProject: () => void
  onLogout: () => void
}

export function HUD({ scale, count, onRecenter, onAddProject, onLogout }: Props) {
  const [syncing, setSyncing] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  // Owner-only: pull the latest from GitHub on demand (new repos + commits +
  // releases + code size). The world's 4s poll then reflects it — meteors and
  // all — within a few seconds.
  const refresh = async () => {
    if (syncing) return
    setSyncing(true); setResult(null)
    try {
      const s = await api.triggerGithubSync()
      const commits = s.pull.results.reduce((n, r) => n + r.commits_added, 0)
      const releases = s.pull.results.reduce((n, r) => n + r.releases_added, 0)
      const repos = s.discover.created.length
      const reconciled = s.discover.updated.length
      const parts: string[] = []
      if (repos) parts.push(`+${repos} new`)
      if (reconciled) parts.push(`${reconciled} updated`)
      if (commits) parts.push(`+${commits} commits`)
      if (releases) parts.push(`+${releases} releases`)
      setResult(parts.length ? parts.join(' · ') : 'already up to date')
    } catch {
      setResult('sync failed')
    } finally {
      setSyncing(false)
      setTimeout(() => setResult(null), 5000)
    }
  }

  return (
    <>
      <div className="hud hud-tl">
        <span className="hud-label">Vatsal's Project World</span>
        <span className="hud-meta">{count} projects · zoom {scale.toFixed(2)}×</span>
      </div>
      <div className="hud hud-tr">
        <button onClick={onAddProject} title="Plant a new project (n)">+ new</button>
        <button onClick={onRecenter} title="Recenter (r)">recenter</button>
        <button
          onClick={refresh}
          disabled={syncing}
          title="Pull the latest from GitHub now"
          className={syncing ? 'syncing' : ''}
        >{syncing ? 'syncing…' : '↻ refresh'}</button>
        <button
          onClick={() => { clearToken(); onLogout() }}
          title="Forget owner token"
          className="ghost"
        >sign out</button>
      </div>
      {result && <div className="hud-sync-result">{result}</div>}
    </>
  )
}
