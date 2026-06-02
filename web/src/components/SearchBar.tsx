/**
 * SearchBar — top-centre filter box. Typing dims non-matching spires and
 * lights up the matches (see House3D searchHit/searchMiss). Shows a live count
 * and an Esc/clear affordance.
 */
interface Props {
  query: string
  onChange: (q: string) => void
  matchCount: number
  total: number
}

export function SearchBar({ query, onChange, matchCount, total }: Props) {
  const active = query.trim().length > 0
  return (
    <div className={`search-bar${active ? ' active' : ''}`}>
      <span className="search-icon">⌕</span>
      <input
        value={query}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onChange('') } }}
        placeholder="search projects, tech, category…"
        spellCheck={false}
        aria-label="Search projects"
      />
      {active && (
        <>
          <span className="search-count">{matchCount}/{total}</span>
          <button className="search-clear" onClick={() => onChange('')} aria-label="Clear search">×</button>
        </>
      )}
    </div>
  )
}
