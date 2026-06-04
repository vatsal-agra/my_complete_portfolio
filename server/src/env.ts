import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { config as loadEnv } from 'dotenv'
import { z } from 'zod'

// Resolve .env.local relative to THIS file's location, not the cwd, so the
// stdio MCP server works when launched from any directory (e.g. a different
// Claude Code session or a Windsurf project on the same machine). dotenv does
// not override already-set keys, so the repo-anchored paths take precedence
// and the cwd-relative paths below remain a fallback for local `pnpm dev`.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../')
loadEnv({ path: resolve(repoRoot, '.env.local') })
loadEnv({ path: resolve(repoRoot, 'server/.env.local') })

// Fallbacks: cwd-relative (covers `pnpm dev` from root or from server/).
loadEnv({ path: '.env.local' })
loadEnv({ path: '../.env.local' })

const Env = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(20),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  INGEST_TOKEN: z.string().min(32),
  GITHUB_TOKEN: z.string().optional().default(''),
  GITHUB_USERNAME: z.string().default('vatsal-agra'),
  // Background auto-sync cadence in minutes (0 = disabled). Defaults to daily;
  // the owner can pull updates on demand via the in-portal Refresh button.
  // Only runs when a GITHUB_TOKEN is present.
  GITHUB_SYNC_MINUTES: z.coerce.number().int().nonnegative().default(1440),
  // Comma-separated list of browser origins allowed to call the API cross-origin
  // (e.g. "https://your-site.netlify.app"). localhost dev origins are always
  // allowed. Same-origin requests (the deployed app calling its own /api) don't
  // need this at all — it only matters for cross-site calls.
  ALLOWED_ORIGINS: z.string().optional().default(''),
  PORT: z.coerce.number().int().positive().default(8787),
})

const parsed = Env.safeParse(process.env)

if (!parsed.success) {
  console.error('Invalid environment variables:')
  console.error(parsed.error.flatten().fieldErrors)
  process.exit(1)
}

export const env = parsed.data
