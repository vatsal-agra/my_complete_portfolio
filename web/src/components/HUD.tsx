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
    setSyncing(true); setResult('syncing…')
    const BATCH = 5
    type PullResult = {
      slug: string; repo: string | null
      commits_added: number; releases_added: number
      code_bytes?: number; error?: string
    }
    const all: PullResult[] = []
    let discover: { created: unknown[]; updated: unknown[] } | null = null
    let offset = 0
    try {
      // Loop: each call processes BATCH repos and stays well under the 26 s
      // Netlify timeout. discover runs on the first call (offset === 0).
      while (true) {
        const r = await api.triggerGithubSyncBatch(offset, BATCH)
        if (r.discover) discover = r.discover
        all.push(...r.pull.results)
        if (r.pull.done) break
        setResult(`syncing ${r.pull.next_offset}/${r.pull.total}…`)
        offset = r.pull.next_offset
      }

      console.log('[sync] discover:', discover)
      console.table(all)

      const commits = all.reduce((n, r) => n + r.commits_added, 0)
      const releases = all.reduce((n, r) => n + r.releases_added, 0)
      const repos = discover?.created.length ?? 0
      const reconciled = discover?.updated.length ?? 0
      const errored = all.filter((r) => r.error).length
      const sizeUpdates = all.filter((r) => typeof r.code_bytes === 'number').length
      const parts: string[] = []
      if (repos) parts.push(`+${repos} new`)
      if (reconciled) parts.push(`${reconciled} updated`)
      if (commits) parts.push(`+${commits} commits`)
      if (releases) parts.push(`+${releases} releases`)
      if (sizeUpdates) parts.push(`${sizeUpdates} resized`)
      if (errored) parts.push(`⚠ ${errored} errored`)
      setResult(parts.length ? parts.join(' · ') : 'already up to date')
    } catch (err) {
      // Surface the real reason. The batch loop means individual timeouts
      // shouldn't happen, but other 5xx / network errors still can.
      let msg = 'sync failed'
      if (err instanceof ApiError) {
        const detail = (err.body as { error?: string; detail?: string } | null)
        msg = `sync failed: ${err.status}${detail?.error ? ` (${detail.error})` : ''}${detail?.detail ? ` — ${detail.detail.slice(0, 80)}` : ''}`
      } else if (err instanceof Error) {
        msg = `sync failed: ${err.message}`
      }
      setResult(msg + (all.length ? ` (partial: ${all.length} done)` : ''))
      console.error('[sync] failed at offset', offset, err)
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
