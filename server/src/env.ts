import { config as loadEnv } from 'dotenv'
import { z } from 'zod'

// Look for .env.local in cwd first, then one level up.
// Covers both `pnpm dev` from root and from server/.
loadEnv({ path: '.env.local' })
loadEnv({ path: '../.env.local' })

const Env = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(20),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  INGEST_TOKEN: z.string().min(32),
  GITHUB_TOKEN: z.string().optional().default(''),
  GITHUB_USERNAME: z.string().default('vatsal-agra'),
  PORT: z.coerce.number().int().positive().default(8787),
})

const parsed = Env.safeParse(process.env)

if (!parsed.success) {
  console.error('Invalid environment variables:')
  console.error(parsed.error.flatten().fieldErrors)
  process.exit(1)
}

export const env = parsed.data
