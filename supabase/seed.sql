-- Dev seed — safe to re-run.
-- Append-only invariant respected: uses ON CONFLICT for projects (idempotent
-- create), and a NOT EXISTS guard before each sample event so reruns don't
-- pile up duplicates.

insert into projects (slug, name, category, goal, repo, tech_stack) values
  ('mockmate', 'MockMate', 'ai-tool',    'Polished interview practice with realistic mocks', 'vatsal-agra/mockmate', array['next.js','openai']),
  ('pipeline', 'Pipeline', 'ai-tool',    'Modular video pipeline with fal.ai + CogVideoX nodes', null, array['python','fal.ai']),
  ('algoviz',  'AlgoViz',  'visualizer', 'Visualize classic algorithms with smooth animation', null, array['react','d3'])
on conflict (slug) do nothing;

insert into events (project_id, type, summary, payload, source)
select p.id, 'next_step', 'Wire fal.ai video node into the pipeline', '{}'::jsonb, 'manual'
from projects p
where p.slug = 'pipeline'
  and not exists (
    select 1 from events e
    where e.project_id = p.id and e.type = 'next_step'
      and e.summary = 'Wire fal.ai video node into the pipeline'
  );

insert into events (project_id, type, summary, payload, source)
select p.id, 'progress', 'Polished onboarding flow', '{}'::jsonb, 'manual'
from projects p
where p.slug = 'mockmate'
  and not exists (
    select 1 from events e
    where e.project_id = p.id and e.type = 'progress'
      and e.summary = 'Polished onboarding flow'
  );

insert into events (project_id, type, summary, payload, source)
select p.id, 'spend', 'GPU rental for CogVideoX testing',
       jsonb_build_object('amount', 14.00, 'currency', 'USD', 'vendor', 'RunPod', 'category', 'compute'),
       'manual'
from projects p
where p.slug = 'pipeline'
  and not exists (
    select 1 from events e
    where e.project_id = p.id and e.type = 'spend'
      and e.summary = 'GPU rental for CogVideoX testing'
  );

insert into events (project_id, type, summary, payload, source)
select p.id, 'metric', 'Razorpay test signups',
       jsonb_build_object('name', 'signups', 'value', 230, 'unit', 'users'),
       'manual'
from projects p
where p.slug = 'mockmate'
  and not exists (
    select 1 from events e
    where e.project_id = p.id and e.type = 'metric'
      and e.payload->>'name' = 'signups'
  );
