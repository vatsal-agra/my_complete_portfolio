import { useState } from 'react'
import { Login } from './components/Login'
import { World3D } from './components/World3D'
import { PublicWorld } from './components/PublicWorld'
import { getToken } from './lib/auth'

/**
 * Access model:
 *   - `/login` (or `/admin`)  → owner login gate; once you have a token, the
 *     owner world. This is how YOU get in.
 *   - `/public`               → always the public, sanitized world (handy for
 *     previewing exactly what visitors see, or sharing a guaranteed-public link).
 *   - everything else (`/`)    → public world for visitors; the FULL owner world
 *     for you, because your token is saved in this browser.
 *
 * Security is enforced server-side regardless of which view renders: `/api/*`
 * requires the owner bearer token, and `/public/*` only ever returns sanitized
 * data from the anon-key views. The routing here is UX, not the security boundary.
 */
export function App() {
  const path = typeof window !== 'undefined' ? window.location.pathname : '/'
  const [authed, setAuthed] = useState<boolean>(!!getToken())

  // Owner login portal — the only place that shows the token gate.
  if (path.startsWith('/login') || path.startsWith('/admin')) {
    return authed
      ? <World3D onLogout={() => setAuthed(false)} />
      : <Login onAuthed={() => setAuthed(true)} />
  }

  // Explicit always-public route (preview / shareable public link).
  if (path.startsWith('/public')) {
    return <PublicWorld />
  }

  // Root: you (token present) get the full world; everyone else gets public.
  return authed
    ? <World3D onLogout={() => setAuthed(false)} />
    : <PublicWorld />
}
