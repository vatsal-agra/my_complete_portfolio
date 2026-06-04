/**
 * GitHub pull worker (ground-truth layer per PROJECT_SPEC §7).
 *
 * For each non-archived project with a `repo` ("owner/name"):
 *   - Fetch recent commits via GitHub REST.
 *   - Compare against existing github_commit event SHAs (dedup).
 *   - Append new commits as github_commit events via in-process ingest().
 *   - Fetch latest release; append a github_deploy event if it's new.
 *   - Ping live_url (if set); append a status_change event when up/down flips.
 *
 * Auth: optional GITHUB_TOKEN env var for higher rate limit + private repos.
 * Errors per repo are caught and reported; the worker continues for others.
 */
import { supabase } from './supabase.js'
import { ingest } from './ingest.js'
import { env } from './env.js'
import type { EventRow } from './types.js'

interface PullSummary {
  ok: true
  scanned: number
  results: ProjectPullResult[]
}

interface ProjectPullResult {
  slug: string
  repo: string | null
  commits_added: number
  releases_added: number
  code_bytes?: number
  goal_set?: boolean
  stack_added?: number
  live_check?: { up: boolean; changed: boolean }
  error?: string
}

interface GitHubCommit {
  sha: string
  commit: { message: string; author: { date: string } }
  html_url: string
}

interface GitHubRelease {
  id: number
  tag_name: string
  name: string | null
  published_at: string
  html_url: string
  draft: boolean
  prerelease: boolean
}

const GITHUB_HEADERS: Record<string, string> = {
  accept: 'application/vnd.github+json',
  'x-github-api-version': '2022-11-28',
  'user-agent': 'project-world/0.1',
}
if (env.GITHUB_TOKEN) GITHUB_HEADERS.authorization = `Bearer ${env.GITHUB_TOKEN}`

interface GitHubRepoListing {
  id: number
  name: string
  full_name: string
  description: string | null
  homepage: string | null
  language: string | null
  topics: string[] | null
  fork: boolean
  archived: boolean
  private: boolean
  pushed_at: string
  created_at: string
  html_url: string
}

interface DiscoverySummary {
  ok: true
  username: string
  scanned: number
  created: Array<{ slug: string; repo: string; name: string }>
  updated: Array<{ repo: string; changes: string[] }>
  skipped: Array<{ repo: string; reason: string }>
}

/**
 * Import every public, non-fork repo under env.GITHUB_USERNAME as a new
 * project row. Existing projects (matched by `repo`) are left alone.
 * Run `pnpm pull:github` after to backfill commits/releases.
 */
export async function discoverRepos(): Promise<DiscoverySummary> {
  const username = env.GITHUB_USERNAME
  if (!username) throw new Error('GITHUB_USERNAME not set')

  // With a token we hit the authenticated endpoint, which returns PRIVATE repos
  // too (visibility=all). Without one we can only see public repos via the
  // public users endpoint.
  const authed = Boolean(env.GITHUB_TOKEN)
  const repos: GitHubRepoListing[] = []
  let page = 1
  while (page < 10) {  // hard cap at 1000 repos
    const url = authed
      ? `https://api.github.com/user/repos?per_page=100&page=${page}&affiliation=owner&visibility=all&sort=pushed`
      : `https://api.github.com/users/${username}/repos?per_page=100&page=${page}&type=owner&sort=pushed`
    const res = await fetch(url, { headers: GITHUB_HEADERS })
    if (!res.ok) throw new Error(`list repos ${username}: ${res.status} ${await res.text()}`)
    const batch = (await res.json()) as GitHubRepoListing[]
    repos.push(...batch)
    if (batch.length < 100) break
    page++
  }

  const { data: existing } = await supabase
    .from('projects')
    .select('id, repo, slug, private, archived, name')
  // Map repo full_name (lowercase) → the stored row, so we can reconcile
  // already-imported repos when their GitHub state changes (visibility flips,
  // archive, rename) instead of skipping them outright.
  const existingByRepo = new Map<string, { id: string; private: boolean; archived: boolean; name: string }>()
  for (const p of (existing ?? []) as Array<{ id: string; repo: string | null; private: boolean; archived: boolean; name: string }>) {
    if (typeof p.repo === 'string') {
      existingByRepo.set(p.repo.toLowerCase(), { id: p.id, private: p.private, archived: p.archived, name: p.name })
    }
  }
  const existingSlugs = new Set((existing ?? []).map((p) => p.slug))

  const created: DiscoverySummary['created'] = []
  const updated: DiscoverySummary['updated'] = []
  const skipped: DiscoverySummary['skipped'] = []

  for (const repo of repos) {
    if (repo.fork)       { skipped.push({ repo: repo.full_name, reason: 'fork' });     continue }
    if (repo.name.toLowerCase() === username.toLowerCase()) {
      skipped.push({ repo: repo.full_name, reason: 'profile README repo' })
      continue
    }
    const prior = existingByRepo.get(repo.full_name.toLowerCase())
    if (prior) {
      // Already imported — reconcile GitHub-authoritative fields if they drifted.
      const patch: Record<string, unknown> = {}
      const changes: string[] = []
      if (prior.private !== repo.private)   { patch.private = repo.private;   changes.push(`private→${repo.private}`) }
      if (prior.archived !== repo.archived) { patch.archived = repo.archived; changes.push(`archived→${repo.archived}`) }
      if (prior.name !== repo.name)         { patch.name = repo.name;         changes.push('renamed') }
      if (changes.length > 0) {
        const { error } = await supabase.from('projects').update(patch).eq('id', prior.id)
        if (error) skipped.push({ repo: repo.full_name, reason: error.message })
        else updated.push({ repo: repo.full_name, changes })
      } else {
        skipped.push({ repo: repo.full_name, reason: 'already imported' })
      }
      continue
    }

    let slug = slugify(repo.name)
    let suffix = 0
    while (existingSlugs.has(slug)) {
      suffix++
      slug = `${slugify(repo.name)}-${suffix}`
    }

    // Seed the new project with a full goal + stack from GitHub so it doesn't
    // land blank. Best-effort: fall back to the cheap listing-derived stack if
    // the deeper fetch fails.
    let goal: string | null = repo.description?.trim() || null
    let techStack = inferTechStack(repo)
    try {
      const enr = await computeEnrichment(repo.full_name, {
        needGoal: !goal,
        needStack: true,
        description: repo.description,
      })
      if (!goal && enr.goal) goal = enr.goal
      if (enr.tech_stack?.length) {
        techStack = dedupeStack([...enr.tech_stack, ...(repo.topics ?? [])]).slice(0, MAX_STACK)
      }
    } catch { /* keep the listing-derived fallback */ }

    const insert = {
      slug,
      name: repo.name,
      category: 'other' as const,
      goal,
      repo: repo.full_name,
      live_url: validUrl(repo.homepage),
      tech_stack: techStack,
      archived: repo.archived,
      private: repo.private,  // hidden from the public/recruiter view (see migration)
    }
    const { error } = await supabase.from('projects').insert(insert)
    if (error) {
      skipped.push({ repo: repo.full_name, reason: error.message })
      continue
    }
    existingSlugs.add(slug)
    created.push({ slug, repo: repo.full_name, name: repo.name })
  }

  return { ok: true, username, scanned: repos.length, created, updated, skipped }
}

export interface SyncSummary {
  ok: true
  discover: DiscoverySummary
  pull: PullSummary
}

/**
 * One full sync pass: discover brings in any NEW repos (incl. private when a
 * token is present), then the pull backfills new commits/releases for every
 * tracked repo. Used by the on-startup + interval scheduler and the manual
 * /api/pull/github/sync endpoint.
 */
export async function runGithubSync(): Promise<SyncSummary> {
  const discover = await discoverRepos()
  const pull = await runGithubPull()
  return { ok: true, discover, pull }
}

function slugify(input: string): string {
  return input.toLowerCase().trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'project'
}

function validUrl(s: string | null): string | null {
  if (!s) return null
  try { new URL(s); return s } catch { return null }
}

function inferTechStack(repo: GitHubRepoListing): string[] {
  const stack = new Set<string>()
  if (repo.language) stack.add(repo.language)
  for (const t of repo.topics ?? []) {
    if (stack.size >= 8) break
    stack.add(t)
  }
  return Array.from(stack)
}

// --- Auto-enrichment of empty owner-facing fields (goal / stack / languages) ---
//
// When a project's `goal` or `tech_stack` is empty we fill it from GitHub on the
// next sync, so towers don't show "— no goal set —" / "— none —". We never touch
// a field the owner has already populated:
//   - goal: filled only when null/blank.
//   - tech_stack: filled when it has ≤1 entry (0 = empty, 1 = the bare
//     discovery seed of just the primary language → effectively "not set").
// Languages come straight from GitHub's per-repo language breakdown; the stack
// (frameworks/tools) is inferred by reading manifest files. Both are merged into
// `tech_stack` — splitTechStack() on the frontend routes them to the right
// "languages" / "stack" branches.

const MAX_STACK = 12

/** Manifest filename → framework/tool display names detected from its contents. */
const MANIFEST_DETECTORS: Array<{ file: string; detect: (text: string) => string[] }> = [
  { file: 'package.json',     detect: detectPackageJson },
  { file: 'requirements.txt', detect: detectPython },
  { file: 'pyproject.toml',   detect: detectPython },
  { file: 'Pipfile',          detect: detectPython },
  { file: 'environment.yml',  detect: detectPython },
  { file: 'go.mod',           detect: detectGoMod },
  { file: 'Cargo.toml',       detect: detectCargo },
  { file: 'Gemfile',          detect: detectGemfile },
  { file: 'composer.json',    detect: detectComposer },
  { file: 'pubspec.yaml',     detect: () => ['Flutter'] },
  { file: 'Dockerfile',       detect: () => ['Docker'] },
  { file: 'docker-compose.yml', detect: () => ['Docker'] },
]

const PACKAGE_DEP_MAP: Record<string, string> = {
  'react': 'React', 'react-dom': 'React', 'next': 'Next.js', 'nuxt': 'Nuxt',
  'vue': 'Vue', 'svelte': 'Svelte', '@sveltejs/kit': 'SvelteKit', 'astro': 'Astro',
  '@angular/core': 'Angular', 'solid-js': 'Solid', 'preact': 'Preact',
  'remix': 'Remix', '@remix-run/react': 'Remix',
  'express': 'Express', 'hono': 'Hono', 'fastify': 'Fastify', 'koa': 'Koa',
  '@nestjs/core': 'NestJS',
  'vite': 'Vite', 'webpack': 'Webpack', 'tailwindcss': 'Tailwind CSS',
  'three': 'Three.js', '@react-three/fiber': 'React Three Fiber',
  'electron': 'Electron', '@supabase/supabase-js': 'Supabase',
  'prisma': 'Prisma', '@prisma/client': 'Prisma', 'drizzle-orm': 'Drizzle',
  'mongoose': 'MongoDB', 'socket.io': 'Socket.IO',
  'redux': 'Redux', 'zustand': 'Zustand', 'graphql': 'GraphQL',
  'tensorflow': 'TensorFlow', '@tensorflow/tfjs': 'TensorFlow.js',
  '@modelcontextprotocol/sdk': 'MCP', 'openai': 'OpenAI', '@anthropic-ai/sdk': 'Anthropic',
}

export function detectPackageJson(text: string): string[] {
  let json: { dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> }
  try { json = JSON.parse(text) } catch { return [] }
  const deps = { ...(json.dependencies ?? {}), ...(json.devDependencies ?? {}) }
  const out: string[] = []
  for (const name of Object.keys(deps)) {
    const mapped = PACKAGE_DEP_MAP[name]
    if (mapped) out.push(mapped)
  }
  return out
}

/** Substring rules over lowercased manifest text → display names. */
function matchRules(text: string, rules: Array<[needle: string, name: string]>): string[] {
  const lower = text.toLowerCase()
  const out: string[] = []
  for (const [needle, name] of rules) {
    if (lower.includes(needle)) out.push(name)
  }
  return out
}

export function detectPython(text: string): string[] {
  return matchRules(text, [
    ['fastapi', 'FastAPI'], ['flask', 'Flask'], ['django', 'Django'],
    ['streamlit', 'Streamlit'], ['gradio', 'Gradio'],
    ['torch', 'PyTorch'], ['tensorflow', 'TensorFlow'], ['scikit-learn', 'scikit-learn'],
    ['sklearn', 'scikit-learn'], ['numpy', 'NumPy'], ['pandas', 'Pandas'],
    ['transformers', 'Hugging Face'], ['langchain', 'LangChain'],
    ['anthropic', 'Anthropic'], ['openai', 'OpenAI'], ['mcp', 'MCP'],
    ['pygame', 'Pygame'], ['scrapy', 'Scrapy'], ['selenium', 'Selenium'],
  ])
}

function detectGoMod(text: string): string[] {
  return matchRules(text, [
    ['gin-gonic', 'Gin'], ['gofiber', 'Fiber'], ['labstack/echo', 'Echo'],
    ['gorilla/mux', 'Gorilla'], ['gorm.io', 'GORM'],
  ])
}

function detectCargo(text: string): string[] {
  return matchRules(text, [
    ['actix', 'Actix'], ['axum', 'Axum'], ['rocket', 'Rocket'],
    ['tokio', 'Tokio'], ['bevy', 'Bevy'],
  ])
}

function detectGemfile(text: string): string[] {
  return matchRules(text, [['rails', 'Rails'], ['sinatra', 'Sinatra']])
}

function detectComposer(text: string): string[] {
  return matchRules(text, [['laravel', 'Laravel'], ['symfony', 'Symfony']])
}

/** Case-insensitive dedupe that preserves first-seen display form and order. */
export function dedupeStack(items: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of items) {
    const t = raw.trim()
    if (!t) continue
    const key = t.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(t)
  }
  return out
}

async function fetchLanguagesMap(repo: string): Promise<Record<string, number> | null> {
  const res = await fetch(`https://api.github.com/repos/${repo}/languages`, { headers: GITHUB_HEADERS })
  if (!res.ok) {
    if (res.status === 404) return null
    throw new Error(`GET languages ${repo}: ${res.status}`)
  }
  return (await res.json()) as Record<string, number>
}

interface GitHubRepoMeta { description: string | null; homepage: string | null }

async function fetchRepoMeta(repo: string): Promise<GitHubRepoMeta | null> {
  const res = await fetch(`https://api.github.com/repos/${repo}`, { headers: GITHUB_HEADERS })
  if (!res.ok) return null
  const j = (await res.json()) as GitHubRepoMeta
  return { description: j.description ?? null, homepage: j.homepage ?? null }
}

const RAW_ACCEPT = 'application/vnd.github.raw'

async function fetchReadme(repo: string): Promise<string | null> {
  const res = await fetch(`https://api.github.com/repos/${repo}/readme`, {
    headers: { ...GITHUB_HEADERS, accept: RAW_ACCEPT },
  })
  if (!res.ok) return null
  const text = await res.text()
  return text.slice(0, 8000)  // first chunk is plenty for a one-line goal
}

async function listRootFiles(repo: string): Promise<Set<string>> {
  const res = await fetch(`https://api.github.com/repos/${repo}/contents`, { headers: GITHUB_HEADERS })
  if (!res.ok) return new Set()
  const arr = (await res.json()) as Array<{ name: string; type: string }>
  return new Set(arr.filter((x) => x.type === 'file').map((x) => x.name))
}

async function fetchTextFile(repo: string, path: string): Promise<string | null> {
  const res = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
    headers: { ...GITHUB_HEADERS, accept: RAW_ACCEPT },
  })
  if (!res.ok) return null
  return await res.text()
}

/** Read root manifests and detect frameworks/tools present in the repo. */
async function inferFrameworks(repo: string): Promise<string[]> {
  const files = await listRootFiles(repo)
  const found: string[] = []
  for (const d of MANIFEST_DETECTORS) {
    if (!files.has(d.file)) continue
    const text = await fetchTextFile(repo, d.file)
    if (!text) continue
    try { found.push(...d.detect(text)) } catch { /* ignore a bad manifest */ }
  }
  return found
}

function cleanInline(s: string): string {
  return s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')      // images
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')   // links → text
    .replace(/[`*_~]/g, '')                     // emphasis / code ticks
    .replace(/\s+/g, ' ')
    .trim()
}

/** First meaningful prose line of a README (skips title/badges/HTML/code). */
export function firstReadmeLine(md: string): string | null {
  const noComments = md.replace(/<!--[\s\S]*?-->/g, '')
  const lines = noComments.split(/\r?\n/)
  let inFence = false
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('```') || line.startsWith('~~~')) { inFence = !inFence; continue }
    if (inFence) continue
    if (line.startsWith('<')) continue          // raw HTML (logos, centered divs)
    if (line.startsWith('![')) continue         // images / badges
    if (/^[-=*_]{3,}$/.test(line)) continue      // horizontal rule
    if (line.startsWith('|')) continue           // table row
    if (line.startsWith('#')) continue           // heading (usually the project name)
    const s = cleanInline(line.replace(/^[>\-*+]\s+/, ''))
    if (s.length >= 8) return s
  }
  return null
}

/** Tidy a goal string: collapse whitespace and clamp to one tidy sentence. */
export function clampGoal(s: string): string {
  const clean = s.replace(/\s+/g, ' ').trim()
  if (clean.length <= 200) return clean
  const cut = clean.slice(0, 200)
  const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '))
  if (lastStop > 80) return cut.slice(0, lastStop + 1)
  return cut.replace(/\s+\S*$/, '') + '…'
}

interface EnrichResult { goal?: string; tech_stack?: string[] }

/**
 * Compute fills for empty fields from GitHub. Only fetches what's needed:
 * languages+manifests for the stack, description+README for the goal.
 */
async function computeEnrichment(
  repo: string,
  opts: { needGoal: boolean; needStack: boolean; description?: string | null; langMap?: Record<string, number> | null },
): Promise<EnrichResult> {
  const out: EnrichResult = {}

  if (opts.needStack) {
    const langMap = opts.langMap !== undefined ? opts.langMap : await fetchLanguagesMap(repo)
    const languages = langMap
      ? Object.entries(langMap).sort((a, b) => b[1] - a[1]).map(([k]) => k)
      : []
    const frameworks = await inferFrameworks(repo)
    const stack = dedupeStack([...languages, ...frameworks]).slice(0, MAX_STACK)
    if (stack.length) out.tech_stack = stack
  }

  if (opts.needGoal) {
    let description = opts.description
    if (description === undefined) {
      const meta = await fetchRepoMeta(repo)
      description = meta?.description ?? null
    }
    let goal = description?.trim() || null
    if (!goal) {
      const readme = await fetchReadme(repo)
      goal = readme ? firstReadmeLine(readme) : null
    }
    if (goal) out.goal = clampGoal(goal)
  }

  return out
}

interface EnrichableProject {
  id: string
  slug: string
  repo: string | null
  goal: string | null
  tech_stack: string[] | null
}

/** Backfill empty goal/stack for one project during a pull pass. */
async function enrichEmptyFields(
  p: EnrichableProject,
  result: ProjectPullResult,
  langMap: Record<string, number> | null,
): Promise<void> {
  if (!p.repo) return
  const needGoal = !p.goal || !p.goal.trim()
  const existingStack = p.tech_stack ?? []
  const needStack = existingStack.length <= 1
  if (!needGoal && !needStack) return

  try {
    const enr = await computeEnrichment(p.repo, { needGoal, needStack, langMap })
    const patch: { goal?: string; tech_stack?: string[] } = {}
    if (needGoal && enr.goal) patch.goal = enr.goal
    if (needStack && enr.tech_stack?.length) {
      patch.tech_stack = dedupeStack([...existingStack, ...enr.tech_stack]).slice(0, MAX_STACK)
    }
    if (Object.keys(patch).length === 0) return
    const { error } = await supabase.from('projects').update(patch).eq('id', p.id)
    if (error) return
    if (patch.goal) result.goal_set = true
    if (patch.tech_stack) result.stack_added = patch.tech_stack.length
  } catch {
    /* enrichment is best-effort; never fail the whole pull over it */
  }
}

const PER_REPO_COMMIT_LIMIT = 30

export async function runGithubPull(): Promise<PullSummary> {
  const { data: projects, error } = await supabase
    .from('projects')
    .select('id, slug, name, repo, live_url, archived, goal, tech_stack')
    .eq('archived', false)
    .not('repo', 'is', null)
  if (error) throw new Error(`load projects: ${error.message}`)

  const results: ProjectPullResult[] = []
  for (const p of projects ?? []) {
    const result: ProjectPullResult = { slug: p.slug, repo: p.repo, commits_added: 0, releases_added: 0 }
    try {
      // Commits
      if (p.repo) {
        // Languages once per repo — drives both the code-size metric (sum of
        // bytes) and the languages part of stack enrichment below.
        const langMap = await fetchLanguagesMap(p.repo)

        const commits = await fetchCommits(p.repo)
        const existingShas = await fetchExistingShas(p.id)
        for (const commit of commits) {
          if (existingShas.has(commit.sha)) continue
          const committedAt = commit.commit.author?.date
          await ingest({
            project: p.slug,
            type: 'github_commit',
            summary: shortMessage(commit.commit.message),
            payload: {
              sha: commit.sha,
              url: commit.html_url,
              committed_at: committedAt,
            },
            source: 'github',
            ...(committedAt ? { ts: committedAt } : {}),
          })
          result.commits_added++
        }

        // Releases
        const releases = await fetchReleases(p.repo)
        const existingReleaseIds = await fetchExistingReleaseIds(p.id)
        for (const r of releases) {
          if (r.draft) continue
          if (existingReleaseIds.has(r.id)) continue
          await ingest({
            project: p.slug,
            type: 'github_deploy',
            summary: `release ${r.tag_name}${r.prerelease ? ' (pre)' : ''}${r.name ? ' — ' + r.name : ''}`,
            payload: {
              release_id: r.id,
              tag: r.tag_name,
              url: r.html_url,
              published_at: r.published_at,
            },
            source: 'github',
            ...(r.published_at ? { ts: r.published_at } : {}),
          })
          result.releases_added++
        }

        // Code size — sum of language bytes ≈ how much code actually lives in
        // the repo's files. A far better "how big is this project" signal than
        // commit count (a huge codebase committed twice should still be tall).
        // Recorded as a metric event, timestamped at the last commit so it
        // doesn't distort recency. Only re-recorded when the size changes.
        const codeBytes = langMap ? Object.values(langMap).reduce((a, b) => a + b, 0) : null
        if (codeBytes !== null && codeBytes > 0) {
          const prev = await lastCodeBytes(p.id)
          if (prev !== codeBytes) {
            const ts = commits[0]?.commit?.author?.date
            await ingest({
              project: p.slug,
              type: 'metric',
              summary: `code size ${Math.round(codeBytes / 1024)} KB`,
              payload: { name: 'code_bytes', value: codeBytes, unit: 'bytes' },
              source: 'github',
              ...(ts ? { ts } : {}),
            })
            result.code_bytes = codeBytes
          }
        }

        // Backfill empty goal / stack / languages from GitHub (best-effort).
        await enrichEmptyFields(p, result, langMap)
      }

      // Live URL ping
      if (p.live_url) {
        const up = await pingLive(p.live_url)
        const prev = await lastLiveState(p.id)
        const changed = prev === null || prev !== up
        if (changed) {
          await ingest({
            project: p.slug,
            type: 'status_change',
            summary: up ? 'live site responding' : 'live site appears down',
            payload: { live: up, url: p.live_url, checked_at: new Date().toISOString() },
            source: 'github',
          })
        }
        result.live_check = { up, changed }
      }
    } catch (err) {
      result.error = err instanceof Error ? err.message : String(err)
    }
    results.push(result)
  }

  return { ok: true, scanned: projects?.length ?? 0, results }
}

async function fetchCommits(repo: string): Promise<GitHubCommit[]> {
  const res = await fetch(`https://api.github.com/repos/${repo}/commits?per_page=${PER_REPO_COMMIT_LIMIT}`, {
    headers: GITHUB_HEADERS,
  })
  if (!res.ok) {
    if (res.status === 404) return []  // private/missing repo — silently skip
    throw new Error(`GET commits ${repo}: ${res.status}`)
  }
  return (await res.json()) as GitHubCommit[]
}

async function fetchReleases(repo: string): Promise<GitHubRelease[]> {
  const res = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=10`, { headers: GITHUB_HEADERS })
  if (!res.ok) {
    if (res.status === 404) return []
    throw new Error(`GET releases ${repo}: ${res.status}`)
  }
  return (await res.json()) as GitHubRelease[]
}

/** Latest recorded code_bytes for a project, for change-detection (dedup). */
async function lastCodeBytes(projectId: string): Promise<number | null> {
  const { data } = await supabase
    .from('events')
    .select('payload')
    .eq('project_id', projectId)
    .eq('type', 'metric')
    .order('ts', { ascending: false })
    .limit(50)
  for (const row of (data ?? []) as Array<Pick<EventRow, 'payload'>>) {
    const p = row.payload as { name?: string; value?: number }
    if (p.name === 'code_bytes' && typeof p.value === 'number') return p.value
  }
  return null
}

async function fetchExistingShas(projectId: string): Promise<Set<string>> {
  const { data } = await supabase
    .from('events')
    .select('payload')
    .eq('project_id', projectId)
    .eq('type', 'github_commit')
    .limit(500)
  const set = new Set<string>()
  for (const row of (data ?? []) as Array<Pick<EventRow, 'payload'>>) {
    const sha = (row.payload as { sha?: string }).sha
    if (typeof sha === 'string') set.add(sha)
  }
  return set
}

async function fetchExistingReleaseIds(projectId: string): Promise<Set<number>> {
  const { data } = await supabase
    .from('events')
    .select('payload')
    .eq('project_id', projectId)
    .eq('type', 'github_deploy')
    .limit(200)
  const set = new Set<number>()
  for (const row of (data ?? []) as Array<Pick<EventRow, 'payload'>>) {
    const id = (row.payload as { release_id?: number }).release_id
    if (typeof id === 'number') set.add(id)
  }
  return set
}

async function lastLiveState(projectId: string): Promise<boolean | null> {
  const { data } = await supabase
    .from('events')
    .select('payload')
    .eq('project_id', projectId)
    .eq('type', 'status_change')
    .order('ts', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!data) return null
  const live = (data.payload as { live?: boolean }).live
  return typeof live === 'boolean' ? live : null
}

async function pingLive(url: string): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 6000)
    const res = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal,
    })
    clearTimeout(timer)
    return res.status >= 200 && res.status < 400
  } catch {
    return false
  }
}

function shortMessage(msg: string): string {
  const first = msg.split('\n')[0]
  return (first ?? msg).slice(0, 200)
}
