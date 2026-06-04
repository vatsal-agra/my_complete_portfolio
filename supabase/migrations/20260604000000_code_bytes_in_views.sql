-- ============================================================================
-- Project World — surface code_bytes in the state views (post-spec enhancement)
-- ============================================================================
-- Height = code size. The owner derives this from code_bytes metric EVENTS
-- client-side, but the public world can't see event payloads (sanitized). So
-- we extract ONLY the latest code_bytes number per project into both views, so
-- the public 3D world can size spires the same way. No other metric payloads
-- are exposed — just the integer byte count.
-- ============================================================================

drop view if exists public_project_state;
drop view if exists project_state;

create view project_state as
select
  p.id,
  p.slug,
  p.name,
  p.category,
  p.goal,
  p.repo,
  p.live_url,
  p.tech_stack,
  p.stage,
  p.private,
  p.manual_position,
  p.created_at,
  agg.last_activity_ts,
  case
    when p.repo is null then 'seedling'::project_status
    when agg.last_non_manual_ts is null
         and p.created_at > now() - interval '3 days'
      then 'seedling'::project_status
    when agg.last_activity_ts > now() - interval '7 days'  then 'thriving'::project_status
    when agg.last_activity_ts > now() - interval '14 days' then 'active'::project_status
    else 'dormant'::project_status
  end as status,
  agg.next_step,
  coalesce(agg.commits_30d, 0) as commits_30d,
  -- Latest code-size reading (bytes). Only the number, nothing else.
  (
    select (e.payload->>'value')::bigint
    from events e
    where e.project_id = p.id
      and e.type = 'metric'
      and e.payload->>'name' = 'code_bytes'
    order by e.ts desc
    limit 1
  ) as code_bytes
from projects p
left join lateral (
  select
    max(e.ts)                                       as last_activity_ts,
    max(e.ts) filter (where e.source <> 'manual')   as last_non_manual_ts,
    (
      select e2.summary
      from events e2
      where e2.project_id = p.id and e2.type = 'next_step'
      order by e2.ts desc
      limit 1
    )                                               as next_step,
    count(*) filter (
      where e.type = 'github_commit' and e.ts > now() - interval '30 days'
    )                                               as commits_30d
  from events e
  where e.project_id = p.id
) agg on true
where not p.archived;

-- Public projection — adds code_bytes, still excludes private projects.
create view public_project_state
  with (security_invoker = false)
  as
select
  slug,
  name,
  category,
  goal,
  repo,
  live_url,
  tech_stack,
  stage,
  status,
  last_activity_ts,
  created_at,
  commits_30d,
  code_bytes
from project_state
where not private;

grant select on public_project_state to anon;
revoke select on project_state from anon;
