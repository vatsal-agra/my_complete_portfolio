import { createClient } from '@supabase/supabase-js'
import { env } from './env.js'

// Owner-side client (full access, used by /api/*, /ingest, MCP tools).
export const supabase = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
)

// Anon-keyed client used by /public/* endpoints. By using the anon key,
// the server queries through the same RLS posture an external attacker
// would see — proving privacy is enforced at the DB layer (PROJECT_SPEC §11).
export const supabaseAnon = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_ANON_KEY,
  { auth: { persistSession: false } },
)
