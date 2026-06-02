import { useState, type FormEvent } from 'react'
import { setToken } from '../lib/auth'

export function Login({ onAuthed }: { onAuthed: () => void }) {
  const [value, setValue] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault()
    setBusy(true); setErr(null)
    const token = value.trim()
    if (!token) { setBusy(false); setErr('paste a token'); return }
    // Smoke-test the token against /api/world before persisting
    const res = await fetch('/api/world', { headers: { 'authorization': `Bearer ${token}` } })
    if (res.ok) {
      setToken(token)
      onAuthed()
    } else if (res.status === 401) {
      setErr('that token did not work')
    } else {
      setErr(`server returned ${res.status}`)
    }
    setBusy(false)
  }

  return (
    <div className="login-shell">
      <form className="login" onSubmit={submit}>
        <h1>project world</h1>
        <p className="sub">paste your owner token to enter</p>
        <input
          type="password"
          placeholder="INGEST_TOKEN"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
        />
        {err && <p className="err">{err}</p>}
        <button type="submit" disabled={busy}>{busy ? 'verifying...' : 'enter'}</button>
      </form>
    </div>
  )
}
