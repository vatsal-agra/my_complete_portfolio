/**
 * Project search — fuzzy-ish substring match across the fields a user is most
 * likely to type: name, slug, category, tech stack, and goal. Case-insensitive,
 * whitespace-tolerant. Returns true for an empty query (everything "matches"
 * so callers can treat empty as "no filter").
 */
import type { ProjectState } from './types'

export function matchesQuery(p: ProjectState, rawQuery: string): boolean {
  const q = rawQuery.trim().toLowerCase()
  if (!q) return true
  const haystack = [
    p.name,
    p.slug,
    p.category,
    p.goal ?? '',
    ...(p.tech_stack ?? []),
  ].join(' ').toLowerCase()
  // Every whitespace-separated term must appear somewhere (AND semantics).
  return q.split(/\s+/).every((term) => haystack.includes(term))
}
