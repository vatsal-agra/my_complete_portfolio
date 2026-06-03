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

  const { data: existing } = await supabase.from('projects').select('id, repo, slug')
  const existingRepos = new Set(
    (existing ?? []).map((p) => (typeof p.repo === 'string' ? p.repo.toLowerCase() : null)).filter(Boolean) as string[],
  )
  const existingSlugs = new Set((existing ?? []).map((p) => p.slug))

  const created: DiscoverySummary['created'] = []
  const skipped: DiscoverySummary['skipped'] = []

  for (const repo of repos) {
    if (repo.fork)       { skipped.push({ repo: repo.full_name, reason: 'fork' });     continue }
    if (repo.name.toLowerCase() === username.toLowerCase()) {
      skipped.push({ repo: repo.full_name, reason: 'profile README repo' })
      continue
    }
    if (existingRepos.has(repo.full_name.toLowerCase())) {
      skipped.push({ repo: repo.full_name, reason: 'already imported' })
      continue
    }

    let slug = slugify(repo.name)
    let suffix = 0
    while (existingSlugs.has(slug)) {
      suffix++
      slug = `${slugify(repo.name)}-${suffix}`
    }

    const techStack = inferTechStack(repo)
    const insert = {
      slug,
      name: repo.name,
      category: 'other' as const,
      goal: repo.description ?? null,
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

  return { ok: true, username, scanned: repos.length, created, skipped }
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

const PER_REPO_COMMIT_LIMIT = 30

export async function runGithubPull(): Promise<PullSummary> {
  const { data: projects, error } = await supabase
    .from('projects')
    .select('id, slug, name, repo, live_url, archived')
    .eq('archived', false)
    .not('repo', 'is', null)
  if (error) throw new Error(`load projects: ${error.message}`)

  const results: ProjectPullResult[] = []
  for (const p of projects ?? []) {
    const result: ProjectPullResult = { slug: p.slug, repo: p.repo, commits_added: 0, releases_added: 0 }
    try {
      // Commits
      if (p.repo) {
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
        const codeBytes = await fetchCodeBytes(p.repo)
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

/** Total bytes of code across all languages GitHub detected in the repo. */
async function fetchCodeBytes(repo: string): Promise<number | null> {
  const res = await fetch(`https://api.github.com/repos/${repo}/languages`, { headers: GITHUB_HEADERS })
  if (!res.ok) {
    if (res.status === 404) return null
    throw new Error(`GET languages ${repo}: ${res.status}`)
  }
  const langs = (await res.json()) as Record<string, number>
  return Object.values(langs).reduce((a, b) => a + b, 0)
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
