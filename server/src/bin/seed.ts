import { supabase } from '../supabase.js'
import { ingest } from '../ingest.js'

type ProjectSeed = {
  slug: string
  name: string
  category: string
  goal?: string
  repo?: string
  tech_stack: string[]
}

const PROJECTS: ProjectSeed[] = [
  { slug: 'mockmate', name: 'MockMate', category: 'ai-tool',    goal: 'Polished interview practice with realistic mocks',     repo: 'vatsal-agra/mockmate', tech_stack: ['next.js', 'openai'] },
  { slug: 'pipeline', name: 'Pipeline', category: 'ai-tool',    goal: 'Modular video pipeline with fal.ai + CogVideoX nodes',                              tech_stack: ['python', 'fal.ai'] },
  { slug: 'algoviz',  name: 'AlgoViz',  category: 'visualizer', goal: 'Visualize classic algorithms with smooth animation',                               tech_stack: ['react', 'd3'] },
]

type SampleEvent = {
  project: string
  type: 'next_step' | 'progress' | 'spend' | 'metric'
  summary: string
  payload?: Record<string, unknown>
}

const SAMPLE_EVENTS: SampleEvent[] = [
  { project: 'pipeline', type: 'next_step', summary: 'Wire fal.ai video node into the pipeline' },
  { project: 'mockmate', type: 'progress',  summary: 'Polished onboarding flow' },
  { project: 'pipeline', type: 'spend',     summary: 'GPU rental for CogVideoX testing',
    payload: { amount: 14, currency: 'USD', vendor: 'RunPod', category: 'compute' } },
  { project: 'mockmate', type: 'metric',    summary: 'Razorpay test signups',
    payload: { name: 'signups', value: 230, unit: 'users' } },
]

async function main(): Promise<void> {
  console.log('seeding projects...')
  for (const p of PROJECTS) {
    const { error } = await supabase
      .from('projects')
      .upsert(p, { onConflict: 'slug', ignoreDuplicates: true })
    if (error) console.error('  skip', p.slug, error.message)
    else console.log('  ok  ', p.slug)
  }

  console.log('seeding events (idempotent — skips if a matching summary already exists)...')
  for (const ev of SAMPLE_EVENTS) {
    const { data: proj } = await supabase
      .from('projects')
      .select('id')
      .eq('slug', ev.project)
      .maybeSingle()
    if (!proj) { console.log('  skip', ev.project, '(no such project)'); continue }

    const { data: existing } = await supabase
      .from('events')
      .select('id')
      .eq('project_id', proj.id)
      .eq('type', ev.type)
      .eq('summary', ev.summary)
      .maybeSingle()
    if (existing) { console.log('  skip', ev.project, ev.type, '(already exists)'); continue }

    await ingest({
      project: ev.project,
      type: ev.type,
      summary: ev.summary,
      payload: ev.payload ?? {},
      source: 'manual',
    })
    console.log('  ok  ', ev.project, ev.type, '-', ev.summary)
  }
  console.log('done.')
}

main().catch((err) => { console.error(err); process.exit(1) })
