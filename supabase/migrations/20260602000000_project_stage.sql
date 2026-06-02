-- ============================================================================
-- Project World — lifecycle stage (post-spec enhancement)
-- ============================================================================
-- Adds a manual `stage` field per project so the 3D world's spire COLOR can
-- encode *intent* (idea / wip / shipped / archived) — orthogonal to the
-- existing `status` field which is derived from recency.
--
-- Note: the existing `archived` BOOLEAN on projects continues to mean
-- "hidden from the world entirely". `stage = 'archived'` is different —
-- it means "this project is finished and still on the map as a memory,
-- shown in a faded hue". The two are independent.
-- ============================================================================

create type project_stage as enum (
  'idea',      -- concept; no real code yet
  'wip',       -- actively building
  'shipped',   -- released to users / has a live URL
  'archived'   -- finished or shelved; still visible, faded
);

alter table projects
  add column stage project_stage not null default 'wip';

-- Reasonable backfill for projects that already exist:
--   live_url present → shipped
--   no repo (placeholder) → idea
--   everything else → wip (the column default already applied)
update projects
   set stage = 'shipped'
 where live_url is not null;

update projects
   set stage = 'idea'
 where repo is null
   and live_url is null;

-- Rebuild project_state to surface the new column. Postgres requires a
-- drop + recreate because column lists change.
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
  coalesce(agg.commits_30d, 0) as commits_30d
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

-- Public projection — stage is safe to expose (it's intent, not money/secrets).
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
  commits_30d
from project_state;

grant select on public_project_state to anon;
revoke select on project_state from anon;
