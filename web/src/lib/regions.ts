/**
 * Regions / territories — cluster projects into named angular sectors on the
 * globe by their `category`, instead of scattering them by slug-hash.
 *
 * Each distinct category present in the data claims an angular wedge of the
 * world. Projects of that category fan out within their wedge (angle), while
 * still sliding in/out radially by recency (see position3d.ts). The result:
 * "AI Tools" cluster in one direction, "Games" in another — instantly legible.
 *
 * Sectors are derived dynamically, so a brand-new category (e.g. a GitHub
 * pull tagging something `other`) automatically gets its own territory — no
 * hardcoded list required. Known categories get a hand-picked label + colour;
 * unknown ones get a deterministic hue so they stay stable across reloads.
 */
import type { ProjectState } from './types'

export interface RegionMeta {
  label: string
  color: string
}

/** Hand-picked labels + colours for the categories we know about. Warm cosmic
 *  palette, deliberately no purple (matches the rest of the world's theme). */
const KNOWN: Record<string, RegionMeta> = {
  'ai-tool':    { label: 'AI Tools',     color: '#f0a868' },
  'ai':         { label: 'AI Tools',     color: '#f0a868' },
  'visualizer': { label: 'Visualizers',  color: '#5fb8c4' },
  'viz':        { label: 'Visualizers',  color: '#5fb8c4' },
  'game':       { label: 'Games',        color: '#e0667f' },
  'games':      { label: 'Games',        color: '#e0667f' },
  'automation': { label: 'Automations',  color: '#9ad06b' },
  'web':        { label: 'Web Apps',     color: '#7da3ff' },
  'saas':       { label: 'SaaS',         color: '#e8b04d' },
  'other':      { label: 'Other',        color: '#9aa0b0' },
}

function hashFrac(s: string, salt = 0): number {
  let h = (2166136261 ^ salt) >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  h ^= h >>> 13
  return (h >>> 0) / 0xffffffff
}

function titleCase(slug: string): string {
  return slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Stable colour for an unknown category — even hue spread, warm-ish sat/light. */
function fallbackColor(category: string): string {
  const hue = Math.floor(hashFrac(category, 7) * 360)
  return `hsl(${hue} 45% 62%)`
}

export function regionMeta(category: string): RegionMeta {
  return KNOWN[category] ?? { label: titleCase(category), color: fallbackColor(category) }
}

export interface Region extends RegionMeta {
  category: string
  /** Centre bearing of this territory's wedge, radians. */
  angleCenter: number
  /** Half-angle the wedge spans; projects fan out within ±this. */
  angleHalfWidth: number
  index: number
  count: number
}

/** Gap between adjacent wedges, as a fraction of each sector's full span. */
const SECTOR_GAP = 0.22

/**
 * Build the territory map for the projects currently in the world. Categories
 * are sorted (largest first, then alphabetical) so the busiest territories get
 * stable, predictable placement and the layout doesn't reshuffle on reload.
 */
export function computeRegions(projects: ProjectState[]): Map<string, Region> {
  const counts = new Map<string, number>()
  for (const p of projects) {
    const cat = p.category || 'other'
    counts.set(cat, (counts.get(cat) ?? 0) + 1)
  }

  const cats = [...counts.keys()].sort((a, b) => {
    const d = (counts.get(b)! - counts.get(a)!)
    return d !== 0 ? d : a.localeCompare(b)
  })

  const n = Math.max(1, cats.length)
  const span = (Math.PI * 2) / n
  const halfWidth = (span / 2) * (1 - SECTOR_GAP)

  const out = new Map<string, Region>()
  cats.forEach((category, index) => {
    const meta = regionMeta(category)
    out.set(category, {
      ...meta,
      category,
      angleCenter: index * span + span / 2,
      angleHalfWidth: halfWidth,
      index,
      count: counts.get(category)!,
    })
  })
  return out
}

/** Per-project bearing within its territory wedge — deterministic spread. */
export function angleInRegion(slug: string, region: Region): number {
  // Single-project territories sit dead-centre; otherwise fan out across the
  // wedge. The 0.85 keeps a sliver of margin so spires don't kiss the border.
  const t = region.count <= 1 ? 0.5 : hashFrac(slug, 3)
  return region.angleCenter + (t - 0.5) * 2 * region.angleHalfWidth * 0.85
}
