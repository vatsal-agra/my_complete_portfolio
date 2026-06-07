import { useState } from 'react'
import { api, ApiError } from '../lib/api'
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
      // Full per-repo breakdown to the console so we can actually see what
      // changed (code_bytes deltas, per-repo errors, etc.) when something
      // doesn't update as expected.
      console.log('[sync] discover:', s.discover)
      console.table(s.pull.results)

      const commits = s.pull.results.reduce((n, r) => n + r.commits_added, 0)
      const releases = s.pull.results.reduce((n, r) => n + r.releases_added, 0)
      const repos = s.discover.created.length
      const reconciled = s.discover.updated.length
      const errored = s.pull.results.filter((r) => (r as { error?: string }).error).length
      const sizeUpdates = s.pull.results.filter((r) => typeof (r as { code_bytes?: number }).code_bytes === 'number').length
      const parts: string[] = []
      if (repos) parts.push(`+${repos} new`)
      if (reconciled) parts.push(`${reconciled} updated`)
      if (commits) parts.push(`+${commits} commits`)
      if (releases) parts.push(`+${releases} releases`)
      if (sizeUpdates) parts.push(`${sizeUpdates} resized`)
      if (errored) parts.push(`⚠ ${errored} errored`)
      setResult(parts.length ? parts.join(' · ') : 'already up to date')
    } catch (err) {
      // Surface the real reason instead of a generic "sync failed". Most
      // likely culprits: 502/504 (function timeout), 5xx (server crash),
      // network (offline). The DevTools Network tab has the full payload.
      let msg = 'sync failed'
      if (err instanceof ApiError) {
        const detail = (err.body as { error?: string; detail?: string } | null)
        msg = `sync failed: ${err.status}${detail?.error ? ` (${detail.error})` : ''}${detail?.detail ? ` — ${detail.detail.slice(0, 80)}` : ''}`
      } else if (err instanceof Error) {
        msg = `sync failed: ${err.message}`
      }
      setResult(msg)
      console.error('[sync] failed', err)
    } finally {
      setSyncing(false)
      setTimeout(() => setResult(null), 10000)
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
