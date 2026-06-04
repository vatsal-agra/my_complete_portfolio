-- ============================================================================
-- Project World — locked private towers in the public world (+ event leak fix)
-- ============================================================================
-- The public world now SHOWS private projects, but as anonymized "locked"
-- towers: position (recency) is kept so they sit naturally among the others,
-- but identity + details are redacted (name → "Private project", anonymized
-- slug derived from the UUID so the real slug can't be guessed, goal/repo/
-- live_url/tech/code-size all stripped). A `private` flag is exposed so the
-- client can render the lock.
--
-- It ALSO fixes a leak: public_events previously exposed private repos' commit
-- summaries (it filtered archived but not private). Now private events are
-- excluded entirely — locked towers have no public activity feed.
-- ============================================================================

drop view if exists public_project_state;
drop view if exists public_events;

-- Public activity feed — now excludes private projects.
create view public_events
  with (security_invoker = false)
  as
select
  e.id,
  e.project_id,
  p.slug as project_slug,
  p.name as project_name,
  e.ts,
  e.type,
  e.summary
from events e
join projects p on p.id = e.project_id
where e.type in ('progress', 'milestone', 'status_change', 'github_commit', 'github_deploy')
  and not p.archived
  and not p.private;

-- Public projection — includes private rows, REDACTED. Real details only for
-- public projects; private rows are anonymized + stripped.
create view public_project_state
  with (security_invoker = false)
  as
select
  case when private then 'locked-' || substr(id::text, 1, 8) else slug end as slug,
  case when private then 'Private project' else name end                  as name,
  case when private then 'private' else category end                      as category,
  case when private then null else goal end                               as goal,
  case when private then null else repo end                               as repo,
  case when private then null else live_url end                           as live_url,
  case when private then array[]::text[] else tech_stack end              as tech_stack,
  case when private then 'wip'::project_stage else stage end              as stage,
  case when private then 'dormant'::project_status else status end        as status,
  last_activity_ts,   -- kept so the locked tower sits at its natural recency
  created_at,
  case when private then 0 else commits_30d end                           as commits_30d,
  case when private then null else code_bytes end                         as code_bytes,
  private             -- the client uses this to render the lock
from project_state;

grant select on public_project_state to anon;
grant select on public_events to anon;
