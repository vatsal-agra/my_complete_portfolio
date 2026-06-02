import { useState } from 'react'
import { Login } from './components/Login'
import { World3D } from './components/World3D'
import { PublicWorld } from './components/PublicWorld'
import { getToken } from './lib/auth'

export function App() {
  // Public route: read-only, sanitized, no auth required.
  // (Public stays on the 2D canvas for now — owner upgrade first.)
  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/public')) {
    return <PublicWorld />
  }
  const [authed, setAuthed] = useState<boolean>(!!getToken())
  if (!authed) return <Login onAuthed={() => setAuthed(true)} />
  return <World3D onLogout={() => setAuthed(false)} />
}
