-- ============================================================================
-- Project World — private towers look normal outside, just can't be opened
-- ============================================================================
-- Reverses the earlier full redaction: private repos now show their real
-- NAME, stage (colour), code size (height), recency (position) and commit
-- count — they're visually indistinguishable from public towers in the world.
--
-- What stays private is the "inside": goal, the GitHub repo link, tech stack,
-- and the whole activity feed (public_events still excludes private). The
-- client blocks clicks on a private tower with a small "can't view" alert, so
-- those card contents never surface. The `private` flag drives that block.
--
-- (public_events is unchanged — it already excludes private from the previous
-- migration, which keeps the activity feed and commit summaries private.)
-- ============================================================================

drop view if exists public_project_state;

create view public_project_state
  with (security_invoker = false)
  as
select
  slug,             -- real (towers look normal)
  name,             -- real
  category,         -- real
  case when private then null else goal end           as goal,        -- card content: private
  case when private then null else repo end           as repo,        -- no GitHub link for private
  case when private then null else live_url end        as live_url,    -- card content: private
  case when private then array[]::text[] else tech_stack end as tech_stack,  -- card content: private
  stage,            -- real (colour)
  status,           -- real
  last_activity_ts, -- real (position)
  created_at,
  commits_30d,      -- real
  code_bytes,       -- real (height)
  private           -- flag → client blocks the click
from project_state;

grant select on public_project_state to anon;
