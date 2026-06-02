-- ============================================================================
-- Project World — Initial schema (Phase 0)
-- ============================================================================
-- Event-sourced single source of truth: never UPDATE/DELETE rows in `events`.
-- Current state is always *derived* via the views below. To "correct" a bad
-- event, append a new event with a corrective summary.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Enums
-- ----------------------------------------------------------------------------

create type event_type as enum (
  'progress',
  'decision',
  'blocker',
  'spend',
  'next_step',
  'milestone',
  'metric',
  'status_change',
  'github_commit',
  'github_deploy',
  'note'
);

create type event_source as enum (
  'claude_session',
  'claude_code',
  'github',
  'manual'
);

create type project_status as enum (
  'seedling',
  'thriving',
  'active',
  'dormant'
);

-- ----------------------------------------------------------------------------
-- Tables
-- ----------------------------------------------------------------------------

create table projects (
  id              uuid primary key default gen_random_uuid(),
  slug            text unique not null,
  name            text not null,
  category        text not null default 'other',
  goal            text,
  repo            text,                       -- GitHub "owner/name"
  live_url        text,
  tech_stack      text[] not null default '{}',
  archived        boolean not null default false,
  manual_position jsonb,                      -- nullable {x, y} override
  created_at      timestamptz not null default now()
);

create table events (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  ts         timestamptz not null default now(),
  type       event_type not null,
  summary    text not null,
  payload    jsonb not null default '{}',
  source     event_source not null default 'manual'
);

-- ----------------------------------------------------------------------------
-- Indexes
-- ----------------------------------------------------------------------------

create index events_project_ts_idx on events (project_id, ts desc);
create index events_type_idx       on events (type);
create index events_ts_idx         on events (ts desc);  -- for Phase 4 time-travel

-- ----------------------------------------------------------------------------
-- Row Level Security
-- ----------------------------------------------------------------------------
-- RLS is ENABLED with NO anon policies in Phase 0. The ingest server uses
-- the service-role key (bypasses RLS). Public read-only access for the anon
-- role arrives in Phase 4 via a sanitized view + policies (PROJECT_SPEC §11).

alter table projects enable row level security;
alter table events   enable row level security;

-- ----------------------------------------------------------------------------
-- Status thresholds (tune here, applied everywhere)
-- ----------------------------------------------------------------------------
--   thriving : any event within  7 days
--   active   : any event within 14 days
--   dormant  : older than 14 days
--   seedling : no repo, OR (no non-manual events AND project < 3 days old)

-- ----------------------------------------------------------------------------
-- Derived views (read-only)
-- ----------------------------------------------------------------------------

-- project_state: one row per non-archived project, with derived fields.
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

-- project_metrics: latest value per (project, metric name).
create view project_metrics as
select distinct on (project_id, payload->>'name')
  project_id,
  payload->>'name' as name,
  payload->'value' as value,
  payload->>'unit' as unit,
  ts               as as_of
from events
where type = 'metric'
order by project_id, payload->>'name', ts desc;

-- world_spend: total spend rolled up by project_category × currency × spend_category.
create view world_spend as
select
  p.category                            as project_category,
  (e.payload->>'currency')              as currency,
  (e.payload->>'category')              as spend_category,
  sum((e.payload->>'amount')::numeric)  as total,
  count(*)                              as event_count
from events e
join projects p on p.id = e.project_id
where e.type = 'spend' and not p.archived
group by p.category, (e.payload->>'currency'), (e.payload->>'category');

-- NOTE (Phase 4): parameterized as_of variants of these views will be added
-- for time-travel replay. Do NOT add them now — building ahead of the current
-- phase violates a CLAUDE.md invariant.
