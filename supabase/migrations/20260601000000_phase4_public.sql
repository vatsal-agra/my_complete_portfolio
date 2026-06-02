-- ============================================================================
-- Phase 4 — Public read-only mode (PROJECT_SPEC §11)
-- ============================================================================
-- Sanitized views exposed to the anon role. Privacy enforced at the DB layer:
-- the underlying `projects` and `events` tables stay RLS-locked, so even an
-- attacker holding the anon key cannot reach sensitive data — they can only
-- read through these explicit views.
--
-- PUBLIC PROJECTION (per spec §11): show only safe signals.
--   ALLOWED: name, slug, category, goal, repo, live_url, tech_stack,
--            status, last_activity_ts, created_at, commits_30d.
--   HIDDEN : next_step (intent), manual_position (layout), id (don't leak fks).
--
-- PUBLIC EVENT TYPES: high-level activity only.
--   ALLOWED: progress, milestone, status_change, github_commit, github_deploy.
--   HIDDEN : spend (money), decision/blocker/note (private reasoning),
--            metric (business numbers can be sensitive), next_step (intent).
-- ============================================================================

-- public_project_state: sanitized projection of the owner's project_state view.
-- security_invoker = false (the default in older Postgres; we set it
-- explicitly for clarity): the view executes with the privileges of its OWNER
-- (typically postgres / service_role), so it can read the underlying tables
-- even though anon's RLS would normally block them.
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
  status,
  last_activity_ts,
  created_at,
  commits_30d
from project_state;

-- public_events: only safe types, only safe columns.
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
  and not p.archived;

-- Grant SELECT on the sanitized views to anon. The underlying tables stay
-- locked — anon SELECT against `projects` or `events` directly is still denied
-- by the RLS-enabled-no-policies posture from the initial migration.
grant select on public_project_state to anon;
grant select on public_events        to anon;

-- Explicitly DENY anon access to the owner-only views (defence in depth).
-- These views were created in the initial migration; revoking is idempotent.
revoke select on project_state   from anon;
revoke select on project_metrics from anon;
revoke select on world_spend     from anon;

-- Note (deliberately not implementing): parameterized `as_of` server-side
-- variants of these views. Phase 4's time-travel runs CLIENT-SIDE over the
-- owner-only full event stream (GET /api/events), so the public anon
-- projection stays simple. If we ever need server-side as_of for public
-- replay, add functions here.
