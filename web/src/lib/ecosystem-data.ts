/**
 * Slice a ProjectDetail into the 6 branches the Ecosystem mind-map renders.
 * Each branch has a small set of leaf strings (the actual data points).
 */
import type { ProjectDetail } from './types'
import { relativeTime } from './time'

const KNOWN_LANGUAGES = new Set([
  'typescript', 'javascript', 'python', 'go', 'golang', 'rust', 'java',
  'c', 'c++', 'cpp', 'c#', 'csharp',
  'swift', 'kotlin', 'objective-c',
  'ruby', 'php', 'html', 'css', 'scss', 'sass',
  'vue', 'svelte',
  'dart', 'r', 'matlab',
  'scala', 'haskell', 'elixir', 'erlang', 'clojure', 'lua', 'perl',
  'shell', 'bash', 'zsh', 'powershell',
  'dockerfile', 'docker',
  'sql', 'graphql',
  'json', 'yaml', 'toml', 'markdown',
])

function isLanguage(t: string): boolean {
  return KNOWN_LANGUAGES.has(t.toLowerCase())
}

export interface Branch {
  key: string
  label: string
  color: string
  items: string[]
  /** Optional small summary line under the header */
  subtitle?: string
}

export function splitTechStack(tech_stack: string[]): { languages: string[]; tools: string[] } {
  const languages: string[] = []
  const tools: string[] = []
  for (const t of tech_stack) {
    if (isLanguage(t)) languages.push(t)
    else tools.push(t)
  }
  return { languages, tools }
}

function fmtMoney(n: number): string {
  if (Math.abs(n) >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 })
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

function fmtMetricValue(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'number') return v.toLocaleString(undefined, { maximumFractionDigits: 2 })
  if (typeof v === 'boolean') return v ? 'yes' : 'no'
  if (typeof v === 'string') return v
  return JSON.stringify(v)
}

const TRUNC = 38
function trunc(s: string, n = TRUNC): string {
  if (s.length <= n) return s
  return s.slice(0, n - 1).trimEnd() + '…'
}

export function buildBranches(detail: ProjectDetail): Branch[] {
  const p = detail.project
  const { languages, tools } = splitTechStack(p.tech_stack)

  // Latest changes — top 4 events of any type (newest first; events already
  // come back newest-first from the API).
  const latest = detail.events.slice(0, 4).map((e) => trunc(e.summary))
  const lastWhen = detail.events[0] ? relativeTime(detail.events[0].ts) : null

  // Goal: project's north star. Split long goals into chunks for readability.
  const goalItems: string[] = []
  if (p.goal) {
    const g = p.goal.trim()
    if (g.length <= 80) goalItems.push(g)
    else {
      // Split by sentence ish
      const parts = g.split(/[.;]\s+/).filter(Boolean).slice(0, 3)
      goalItems.push(...parts.map((s) => trunc(s, 60)))
    }
  } else {
    goalItems.push('— no goal set —')
  }

  // Stack tools (non-language).
  const stackItems = tools.length > 0 ? tools.slice(0, 5) : ['— no tools listed —']

  // Languages.
  const langItems = languages.length > 0 ? languages.slice(0, 4) : ['— none —']

  // Money.
  const spendByCurrency = Object.entries(detail.spend_summary.by_currency)
  const spendItems: string[] = []
  let spendSubtitle: string | undefined
  if (spendByCurrency.length > 0) {
    spendSubtitle = spendByCurrency.map(([cur, amt]) => `${fmtMoney(amt)} ${cur}`).join(' · ')
    const byCat = Object.entries(detail.spend_summary.by_category).sort((a, b) => b[1] - a[1]).slice(0, 3)
    const byVendor = Object.entries(detail.spend_summary.by_vendor).sort((a, b) => b[1] - a[1]).slice(0, 2)
    for (const [c, amt] of byCat) spendItems.push(`${c}: ${fmtMoney(amt)}`)
    for (const [v, amt] of byVendor) spendItems.push(`${v}: ${fmtMoney(amt)}`)
  } else {
    spendItems.push('— nothing tracked yet —')
  }

  // Metrics.
  const metricItems = detail.metrics.length > 0
    ? detail.metrics.slice(0, 5).map((m) => `${m.name}: ${fmtMetricValue(m.value)}${m.unit ? ' ' + m.unit : ''}`)
    : ['— no metrics yet —']

  return [
    { key: 'goal',    label: 'goal',      color: '#ffd9a0', items: goalItems },
    { key: 'latest',  label: 'latest',    color: '#86efac', items: latest.length > 0 ? latest : ['— no activity yet —'],
      subtitle: lastWhen ?? undefined },
    { key: 'stack',   label: 'stack',     color: '#93c5fd', items: stackItems },
    { key: 'langs',   label: 'languages', color: '#f9a8d4', items: langItems },
    { key: 'metrics', label: 'metrics',   color: '#fcd34d', items: metricItems },
    { key: 'spend',   label: 'spend',     color: '#fdba74', items: spendItems, subtitle: spendSubtitle },
  ]
}
