import { useState, type FormEvent } from 'react'
import { api, ApiError } from '../lib/api'
import type { NewProjectInput, ProjectState } from '../lib/types'

const CATEGORIES = ['game', 'ai-tool', 'automation', 'visualizer', 'web', 'other']

export function AddProject({ onClose, onCreated }: { onClose: () => void; onCreated: (p: ProjectState) => void }) {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [category, setCategory] = useState('other')
  const [goal, setGoal] = useState('')
  const [repo, setRepo] = useState('')
  const [tech, setTech] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Auto-suggest slug from name as you type, but allow overrides.
  function nameChanged(v: string): void {
    setName(v)
    if (!slug || slug === slugify(name)) setSlug(slugify(v))
  }

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault()
    setErr(null); setBusy(true)
    try {
      const input: NewProjectInput = {
        slug: slug.trim(),
        name: name.trim(),
        category,
      }
      if (goal.trim()) input.goal = goal.trim()
      if (repo.trim()) input.repo = repo.trim()
      const stack = tech.split(',').map((t) => t.trim()).filter(Boolean)
      if (stack.length > 0) input.tech_stack = stack
      const created = await api.createProject(input)
      onCreated(created)
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 409) setErr('slug already taken')
        else if (e.status === 400) setErr('check the fields (slug must be lowercase + hyphens)')
        else setErr(`server returned ${e.status}`)
      } else {
        setErr('network error')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>new project</h2>

        <label>name<input value={name} onChange={(e) => nameChanged(e.target.value)} required autoFocus /></label>
        <label>slug<input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="lowercase-with-hyphens" required /></label>
        <label>category
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label>goal (north star)<textarea value={goal} onChange={(e) => setGoal(e.target.value)} rows={2} /></label>
        <label>github repo (owner/name)<input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="vatsal-agra/something" /></label>
        <label>tech stack (comma-separated)<input value={tech} onChange={(e) => setTech(e.target.value)} placeholder="react, supabase, hono" /></label>

        {err && <p className="err">{err}</p>}

        <div className="actions">
          <button type="button" onClick={onClose}>cancel</button>
          <button type="submit" className="primary" disabled={busy}>{busy ? 'planting...' : 'plant'}</button>
        </div>
      </form>
    </div>
  )
}

function slugify(s: string): string {
  return s.toLowerCase().trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}
