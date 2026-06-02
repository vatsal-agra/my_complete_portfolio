import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { WorldSpendRow } from '../lib/types'

interface CurrencyRollup {
  currency: string
  total: number
  byCategory: Array<{ category: string; total: number }>
}

function rollup(rows: WorldSpendRow[]): CurrencyRollup[] {
  const byCurrency = new Map<string, CurrencyRollup>()
  for (const r of rows) {
    const cur = r.currency ?? '?'
    if (!byCurrency.has(cur)) byCurrency.set(cur, { currency: cur, total: 0, byCategory: [] })
    const c = byCurrency.get(cur)!
    c.total += Number(r.total)
    const catName = r.spend_category ?? 'other'
    const existing = c.byCategory.find((x) => x.category === catName)
    if (existing) existing.total += Number(r.total)
    else c.byCategory.push({ category: catName, total: Number(r.total) })
  }
  for (const c of byCurrency.values()) c.byCategory.sort((a, b) => b.total - a.total)
  return Array.from(byCurrency.values()).sort((a, b) => b.total - a.total)
}

export function WorldSpend() {
  const [rows, setRows] = useState<WorldSpendRow[] | null>(null)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    let cancelled = false
    function load() {
      api.worldSpend().then((d) => { if (!cancelled) setRows(d) }).catch(() => {})
    }
    load()
    const id = setInterval(load, 30_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  if (!rows || rows.length === 0) return null
  const rolled = rollup(rows)

  return (
    <div className="world-spend" onClick={() => setExpanded((e) => !e)} role="button" tabIndex={0}>
      <div className="ws-label">portfolio spend</div>
      <div className="ws-totals">
        {rolled.map((r) => (
          <div key={r.currency} className="ws-total">
            <span className="ws-amt">{r.total.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
            <span className="ws-cur">{r.currency}</span>
          </div>
        ))}
      </div>
      {expanded && (
        <div className="ws-detail">
          {rolled.map((r) => (
            <div key={r.currency} className="ws-currency-block">
              <div className="ws-cur-head">{r.currency}</div>
              {r.byCategory.slice(0, 3).map((c) => (
                <div key={c.category} className="ws-cat-row">
                  <span>{c.category}</span>
                  <span>{c.total.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
