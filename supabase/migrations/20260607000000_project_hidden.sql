-- ============================================================================
-- Project World — owner can hide a project from the world
-- ============================================================================
-- Adds `projects.hidden` (default false). When true, the project is filtered
-- out of `project_state` (and therefore `public_project_state`, which derives
-- from it). Events stay untouched — the append-only invariant is unchanged,
-- and flipping `hidden` back to false brings the tower back exactly as it was.
--
-- Why a flag and not a delete: the events table is append-only and many rows
-- (github_commit, metric, spend, …) FK to projects.id. Hard-deleting would
-- either need a cascade that wipes the audit trail, or orphan handling. A
-- column on the projects table is the cheap, reversible answer.
-- ============================================================================

alter table projects
  add column if not exists hidden boolean not null default false;

-- Rebuild the views so they exclude hidden projects. Drop in dependency order
-- (public_project_state -> project_state).
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
where not p.archived
  and not p.hidden;

-- Rebuild public view (preserves 20260606's private-but-outside-visible rules).
create view public_project_state
  with (security_invoker = false)
  as
select
  slug,
  name,
  category,
  case when private then null else goal end                   as goal,
  case when private then null else repo end                   as repo,
  case when private then null else live_url end                as live_url,
  case when private then array[]::text[] else tech_stack end  as tech_stack,
  stage,
  status,
  last_activity_ts,
  created_at,
  commits_30d,
  code_bytes,
  private
from project_state;

grant select on public_project_state to anon;
revoke select on project_state from anon;
