# Project World — Build Spec for Claude Code

## 0. Read this first (how I want you to work)

You are building a greenfield web application from scratch. This document is the complete spec. **Your first action is to save this entire document to the repo as `PROJECT_SPEC.md`** so it lives on disk and we don't burn conversation context re-reading it. Treat it as the reference you return to at the start of every phase.

Then set up your working context:
1. Create a short **`CLAUDE.md`** in the repo root holding only the always-true rules — build/test/run commands once they exist, the invariants below, code-style choices, and the "verify before done" rule. Keep it short: include only things that would cause mistakes if removed. Detailed design stays in `PROJECT_SPEC.md`, not `CLAUDE.md` — a bloated CLAUDE.md gets ignored.
2. Use **plan mode** to explore and think before each phase. Produce a short plan for Phase 0 and confirm the tech stack and data model below with me. If you'd change anything, say what and why — don't silently deviate. If any part of this spec is ambiguous or forces a consequential assumption, **interview me with the AskUserQuestion tool before coding that part** instead of guessing.
3. Build **phase by phase** (Section 13). At the **end of each phase**: show evidence the success criteria pass, then run an **adversarial review in a fresh subagent** against `PROJECT_SPEC.md` (use the `/code-review` skill or a review prompt) to catch gaps. Then pause for my review.
4. Between phases, run **`/clear`** (or start a fresh session) and re-read `PROJECT_SPEC.md` plus the relevant section, so context stays clean. Context degradation is the main failure mode for a build this size — manage it aggressively.

Hard rules for the whole build (these are invariants — put them in `CLAUDE.md`):
- **YOU MUST keep events append-only.** Events are the single source of truth; never overwrite or mutate history. All current state is *derived* (Section 5).
- **YOU MUST keep secrets in environment variables** (Supabase keys, GitHub token, MCP/ingest token). Never hardcode or commit secrets. Provide a `.env.example`. The public read-only mode must never leak private data — enforce it at the database layer (Section 11).
- **Give yourself a way to verify every phase.** Write tests / a runnable check / screenshots for each phase's success criteria, run them, and show the evidence (test output, the command and its result, or a screenshot). If you can't verify it, it isn't done.
- Do **not** build everything in one pass. Incremental, reviewable phases only.
- Keep it **free-tier friendly** and dependencies lean and well-maintained.
- Use the **`gh` CLI** for GitHub operations.
- It's fine to try a risky approach and rewind if it fails — checkpoints make experiments cheap.

About me (the only owner of this app): CS student, solo developer. GitHub username: **vatsal-agra**. I build a lot of projects in parallel — games, AI tools, n8n automations, algorithm visualizers — and I want one place that tracks all of them without manual upkeep.

---

## 1. The vision (what we are really building)

I'm building a lot of projects at once and it's impossible to hold their state in my head. I don't want a Notion board I have to hand-update — that's just a second copy of reality I have to keep syncing.

Instead I want a **living world**: a blank, infinite white space I can pan and zoom around like Google Earth (not literal maps — just that navigation *feel*). Scattered across this world are my projects, each rendered as a labeled "house" (or similar structure) I can see as I scroll past. I can add new projects and view existing ones.

When I zoom into a project, the house **expands into that project's entire ecosystem** — its goal, its progress, the changes made, money spent, the next step, and any other metrics. The set of metrics is open-ended.

The world stays current on its own through two directions of data flow:
- **Push (my idea, the core):** my Claude sessions report progress. As I work with Claude on a project, the act of working *emits* a small structured update — a decision made, money spent, a milestone, a blocker, the next step — which gets sent to this app and filed under the right project. This captures the *narrative and reasoning* layer that a Git history never sees.
- **Pull (ground truth):** the app also reads my GitHub activity on a schedule — commits, deploys, whether the live site is up. This is the hard factual layer.

Together: push gives the *why*, pull gives the *what*. The world is alive whether or not I'm looking at it.

This is also, eventually, a public portfolio piece — a live link I can show recruiters of everything I'm building, auto-updating.

---

## 2. Core concept / mental model

Internalize these five ideas — they drive every design decision:

1. **The world** — an infinite, pannable, zoomable white canvas. Abstract space, not a map. Smooth pan (drag) and zoom (wheel/pinch).
2. **Projects are places** — each project is a labeled structure positioned in the world. Labels are readable while panning at a medium zoom.
3. **Semantic zoom (level-of-detail)** — this is the spine of the "fall into it" feel. Zoomed far out: a house is a small labeled marker with a health color. Cross a zoom threshold and that house **unfolds in place** into the project's full interior dashboard. Same canvas, no page navigation.
4. **Self-updating via push + pull** — see Section 1. The app never requires manual data entry to stay current (manual editing is allowed for a few fields, but is never *required*).
5. **Event-sourced** — every update is an immutable, append-only **event**. A project's current state (phase, last activity, total spend, next step) is always **derived** from its event stream. Nothing is ever overwritten. This is what makes the time-travel replay (Section 10) almost free.

---

## 3. Architecture

Six components:

- **Ingestion core** — a single authenticated `POST /ingest` endpoint. This is the *only* way data enters the system. Everything else is a front door to it.
- **MCP server** — a thin wrapper over the ingestion core that exposes tools (e.g. `log_update`) so my Claude sessions can push updates. (See Section 6.)
- **GitHub pull worker** — a scheduled job that fetches my GitHub activity and writes ground-truth events through the same ingestion core. (See Section 7.)
- **Store** — Postgres (via Supabase): an append-only `events` table, a `projects` table, and derived **views** for current state. Realtime enabled. Row-Level Security for the public read-only mode.
- **World frontend** — React + TS + Vite. Reads derived state, subscribes to realtime so the world updates live.
- **Interior** — the semantic-zoom expansion of a single project.

Data flow: `Claude sessions → MCP → /ingest → events` and `GitHub → pull worker → /ingest → events`; then `events → derived state views → World frontend → (zoom) → Interior`.

---

## 4. Tech stack

Use these unless you propose something better in your plan:

- **Frontend:** React + TypeScript + Vite.
- **World canvas / pan-zoom:** start with `react-zoom-pan-pinch` (or `@use-gesture/react` + a CSS transform on a "stage" element) for the infinite pannable/zoomable canvas. Houses are React components positioned in world coordinates; semantic zoom swaps each house's rendered detail based on the current zoom scale (thresholds). **Upgrade path:** if performance or the richer "living" visuals (Section 8) need it, migrate the rendering layer to **PixiJS** (WebGL canvas) later. Recommend your choice in your plan.
- **Ingestion + MCP server:** Node + TypeScript, using the official MCP TypeScript SDK (`@modelcontextprotocol/sdk`). Keeping the whole stack in TS is intentional. The MCP server should be a **remote** server (HTTP/SSE transport) with bearer-token auth so I can register it as a custom connector in Claude.
- **Database / realtime / auth:** Supabase (Postgres + Realtime + Auth + RLS).
- **Scheduled GitHub pull:** a cron-triggered worker (a small Node service with a scheduler on Railway/Render, or a scheduled Supabase Edge Function, or a GitHub Action on a cron). Pick the simplest reliable option and justify it.
- **Hosting:** Vercel (frontend) + Railway or Render (MCP server + pull worker) + Supabase (DB). All free tiers.

---

## 5. Data model

This is a starting schema — refine it in your plan, but keep the event-sourced shape.

**`projects`** (one row per project; mix of manual and derived-cache fields):
- `id` (uuid, pk)
- `slug` (text, unique — stable human ID, e.g. `mockmate`)
- `name` (text)
- `category` (text/enum: `game`, `ai-tool`, `automation`, `visualizer`, `web`, `other`)
- `goal` (text, nullable — the project's north star)
- `repo` (text, nullable — GitHub `owner/name`)
- `live_url` (text, nullable)
- `tech_stack` (text[])
- `archived` (boolean, default false)
- `manual_position` (jsonb, nullable — optional `{x,y}` override; normally position is computed, see 8)
- `created_at` (timestamptz)

**`events`** (append-only — the single source of truth):
- `id` (uuid, pk)
- `project_id` (uuid, fk → projects)
- `ts` (timestamptz, default now())
- `type` (enum: `progress` | `decision` | `blocker` | `spend` | `next_step` | `milestone` | `metric` | `status_change` | `github_commit` | `github_deploy` | `note`)
- `summary` (text — one-line human-readable)
- `payload` (jsonb — type-specific structured data; see examples below)
- `source` (enum: `claude_session` | `claude_code` | `github` | `manual`)

**Derived read models (Postgres views, not tables):**
- `project_state` — per project: `last_activity_ts`, computed `status` bucket (see below), `total_spend` (sum of `spend` event amounts, grouped by currency), latest `next_step`, `goal`, 30-day commit count, `is_live`, etc.
- `project_metrics` — per project, the **latest** value for each distinct `metric` event `payload.name` (this powers the open-ended "countless metrics" — sending a new metric name spawns a new card).
- `world_spend` — total spend across all non-archived projects, grouped by currency and by category (powers "what my portfolio costs me per month").

**Status buckets** (derived from `last_activity_ts` + whether a repo exists):
- `seedling` — no repo yet, or created very recently with minimal activity (idea stage).
- `thriving` — high recent activity (e.g. commits/updates in the last ~7 days).
- `active` — some activity in the last ~14 days.
- `dormant` — no activity for longer.
(Tune thresholds; make them constants.)

**Example event payloads:**
```jsonc
// spend
{ "type": "spend", "summary": "GPU rental for CogVideoX testing",
  "payload": { "amount": 14.00, "currency": "USD", "vendor": "RunPod", "category": "compute" } }

// metric (open-ended — any name creates a card in the interior)
{ "type": "metric", "summary": "Razorpay test signups",
  "payload": { "name": "signups", "value": 230, "unit": "users" } }

// next_step
{ "type": "next_step", "summary": "Wire fal.ai video node into the pipeline",
  "payload": {} }

// github_commit (written by the pull worker)
{ "type": "github_commit", "summary": "Fix camera crash on Android",
  "payload": { "sha": "a1b2c3", "additions": 40, "deletions": 12 } }
```

---

## 6. The ingestion contract (push)

**`POST /ingest`** — the single entry point. Auth via `Authorization: Bearer <INGEST_TOKEN>` (token from env). Body:
```jsonc
{
  "project": "mockmate",          // slug or name; see auto-create rule
  "type": "progress",             // one of the event types
  "summary": "Polished onboarding flow",
  "payload": { },                 // optional, type-specific
  "source": "claude_session"      // optional; default "manual"
}
```
- **Auto-create rule:** if `project` doesn't match an existing slug/name, create a minimal `projects` row (status `seedling`) and attach the event. This lets me start tracking a project just by mentioning it.
- Validate `type` against the enum; reject unknown types with a clear error.
- Return the created event and the project's refreshed `project_state`.

**MCP server** — wrap the ingestion core. Expose these tools:
- `log_update(project, type, summary, payload?)` → calls `/ingest`.
- `list_projects()` → returns slugs + names + current status (so a session can pick the right project).
- `set_next_step(project, text)` → convenience wrapper that logs a `next_step` event.
- `log_spend(project, amount, currency, vendor?, category?, note?)` → convenience wrapper for `spend`.

The MCP server authenticates to `/ingest` with the same bearer token (server-side env var), so Claude never handles the secret.

**Fallback ingestion (build this in Phase 0, before MCP):** because `/ingest` is just an authenticated POST, also provide a tiny way to push without MCP — e.g. a one-page authenticated form, or a documented `curl`/bookmarklet snippet — so ingestion works from day one even before the connector is wired.

---

## 7. The GitHub pull (ground truth)

A scheduled worker (every few hours) that, for each project with a `repo`:
- Fetches recent commits, last push time, open issues count, and release/deploy info via the GitHub REST API (auth via `GITHUB_TOKEN` env var for higher rate limits + private repos).
- Pings `live_url` (if set) to record whether the site is up.
- Writes `github_commit` / `github_deploy` / `status_change` events through `/ingest` with `source: "github"`.
- **Dedup:** never write a duplicate commit event — track the last-seen commit SHA per repo and only ingest new ones (store a cursor, or check existing events).
- Optionally also discover repos under `vatsal-agra` that aren't yet projects and create them as `seedling`s (make this behavior a config flag).

---

## 8. The world (read view) — detailed

### Visual identity (important — this is the product's soul)
The world *is* the experience, so it must have a distinctive, cohesive look — not a generic dashboard. Do NOT use default AI-slop aesthetics: avoid overused fonts (Inter, Roboto, Arial, system defaults) and clichéd schemes (especially purple-gradient-on-white or dark). Make an intentional type choice, a cohesive palette, and add tasteful motion and micro-interactions — pan/zoom easing, houses settling into place, a gentle pulse when an update lands. The blank white space is deliberate: keep it calm and uncluttered and let the projects and their states carry the visual interest. Aim for something that feels crafted, like a place worth wandering — not a CRUD admin panel.

- Infinite white canvas, smooth pan (drag) and zoom (wheel/pinch/trackpad). Sensible min/max zoom. A "reset/recenter" control.
- Each project renders as a structure ("house") at its world position with a label.
- Clicking a house selects/focuses it (smooth-pan-to and zoom-in slightly).
- **Semantic zoom thresholds:** far zoom = marker + label + health color only; mid zoom = add key stats (last activity, next step snippet); past the inner threshold = the house **unfolds into the full interior** (Section 9). Transitions should feel continuous.
- Add-project affordance (button or double-click empty space) → minimal create form (name, category, repo, goal). New projects can be created by ingestion too.

### Feature — spatial meaning (position and form carry information for free)
Make the layout *mean something* so I can feel my portfolio's energy at a glance, with zero manual placement:
- **Position by activity:** active projects sit near the **center**; the longer a project has been neglected, the further it **drifts to the outskirts**. Concretely: compute a stable angle per project (hash of slug) and a radius that grows with days-since-last-activity (`thriving` near center → `dormant` far out). Respect `manual_position` if set. Recompute as state changes.
- **Optional clustering** by `category` into loose districts (games here, AI tools there) — nice-to-have, behind the activity rule.
- **Form by health (visual tiers):**
  - `thriving` → bright, tall, detailed structure.
  - `active` → normal, lit structure.
  - `dormant` → faded / overgrown / dimmed.
  - `seedling` → a small sapling or a construction-site plot (clearly "not built yet").
- Start with simple visual differentiation (color, size, opacity, a few decorative elements). This is the layer most worth upgrading to PixiJS later for richer rendering.

---

## 9. The project interior — detailed

When a house unfolds, show the project's full ecosystem. Sections:
- **Header:** name, category, current status badge, one-line current state, links (repo, live site).
- **Goal / north star.**
- **Next step** — always prominent (latest `next_step` event).
- **Timeline / changelog** — the project's event stream, newest first, human-readable, with type icons (this is the heartbeat; includes both my pushed updates and GitHub events).
- **Blockers / open questions** — open `blocker` events.
- **Tech stack** and metadata.
- **Custom metric cards** — a flexible grid rendering `project_metrics` (latest value per metric name). Any new metric name sent via ingestion automatically appears as a new card. This is the open-ended "countless metrics" requirement — do **not** hardcode the metric set.

### Feature — money layer
- In the interior, show **total spend for this project** (from `spend` events), broken down by category/vendor, with the underlying spend events listed.
- At the **world level**, show a roll-up: **total spend across all projects** (the `world_spend` view), grouped by currency and category — i.e. "what my whole portfolio costs me per month." Surface this somewhere global (a HUD corner or an overview panel). For a student this is real signal — GPU rentals, API bills, domains.

---

## 10. Feature — time-travel replay

Because events are append-only and timestamped, the world's state at any past moment is fully reconstructable.
- Add a **timeline scrubber** (global control). Dragging it re-derives the world as of timestamp `T`: only events with `ts <= T` count, so positions, statuses, spend totals, and which projects even *exist* all reflect that moment.
- A **play** button animates forward through time — watch projects get born, grow, swell, and go quiet. A replay of my building journey.
- Implementation: parameterize the derived-state queries by an optional `as_of` timestamp; the frontend requests state snapshots (or computes them client-side from the event stream) as the scrubber moves.

---

## 11. Feature — public read-only mode

A shareable, sanitized version of the world for recruiters/outreach.
- A separate route (e.g. `/public` or a per-share token link) that renders the world **read-only**.
- **Privacy filtering is mandatory:** the public projection must **exclude** sensitive data — money/`spend`, private `decision`/`blocker`/`note` content — and show only safe signals (project names, categories, status, goals, high-level progress, public repo/live links, activity recency). Enforce this at the **database layer** with Supabase Row-Level Security (anon role can read only a sanitized view), not just in the UI.
- This is meant to be a live link I can send to companies — treat its polish and privacy correctness as important.

---

## 12. Realtime & "alive" behavior

- Use Supabase Realtime so the world reflects new events **without a refresh** — when an update lands, the relevant house should visibly react (a brief pulse/highlight, updated stats, possible status/position change).
- A subtle **self-narrating ticker**: a feed of recent events across all projects ("MockMate shipped onboarding · Pipeline added fal.ai node · new seedling planted: vector-db-transpiler"). Keep it ambient and non-intrusive.

---

## 13. Build phases (build in this order — pause after each for review)

Each phase's **Success** criteria are its verification gate: turn them into runnable checks (automated tests, a script that diffs output, or screenshots compared to the intended look), run them, and show the evidence before moving on. End each phase with an end-to-end check that proves the feature actually works — not just that the code compiles — then the adversarial subagent review against this spec.

**Phase 0 — The spine (data + ingestion).**
Deliverables: repo scaffold (suggest a monorepo: `web/`, `server/`, and Supabase migrations); `.env.example`; Supabase schema + migrations (`projects`, `events`, the derived views); the `POST /ingest` ingestion core with auth + auto-create; the MCP server wrapping it (`log_update`, `list_projects`, `set_next_step`, `log_spend`); a seed script; and the no-MCP fallback ingestion path.
Success: I can push an update (via MCP locally and/or the fallback) and see the event land in Postgres; `project_state` and `project_metrics` views return correct derived data.

**Phase 1 — The world (read view).**
Deliverables: React + Vite app; infinite pannable/zoomable white canvas; houses rendered from `project_state` with labels and health colors; click-to-focus; add-project form.
Success: smooth pan/zoom; all projects visible and labeled; positions reflect activity (Section 8 spatial rule, basic version).

**Phase 2 — The interior (semantic zoom).**
Deliverables: zoom-threshold unfolding of a house into the full interior (Section 9), including the flexible metric-card grid driven by events, the timeline, next step, and per-project spend.
Success: zooming into any project expands it in place; sending a new metric name creates a new card with no code change.

**Phase 3 — Life + synthesis.**
Deliverables: GitHub pull worker (Section 7) writing ground-truth events; Supabase Realtime wiring so houses update/pulse live; the visual health tiers (Section 8 form); the world-level money roll-up (Section 9 money layer); the self-narrating ticker.
Success: GitHub activity appears automatically; the world updates live; spend roll-up is correct; neglected projects visibly drift out and fade.

**Phase 4 — Replay + public mode.**
Deliverables: the time-travel scrubber + play animation (Section 10); the public read-only route with RLS-enforced privacy filtering (Section 11).
Success: scrubbing re-derives the world at past timestamps; the public link shows a correct, sanitized, read-only world that leaks no money or private notes.

---

## 14. Constraints & non-goals

- **Not Google Earth / not a real map** — an abstract infinite 2D canvas with that navigation *feel*.
- **Single owner (me) + public read-only viewers.** No multi-user accounts, no team features, no multi-tenancy.
- **Event-sourcing is non-negotiable:** events are append-only and the single source of truth; never overwrite history; current state is always derived.
- **Secrets in env only**; provide `.env.example`; never commit keys; the MCP server and pull worker hold the ingest token server-side so Claude/clients never see it.
- **Free-tier friendly**; lean dependencies.
- **Responsive enough to view on a phone** (I'll check it on mobile), though the primary experience is desktop.
- Don't over-engineer. Prefer the simplest thing that satisfies each phase's success criteria.

---

## 15. Start now

In order: (1) save this document as `PROJECT_SPEC.md` in the repo; (2) create a short `CLAUDE.md` with the Section 0 invariants; (3) enter plan mode, then reply with your Phase 0 plan, confirm or refine the stack and data model, and interview me on anything ambiguous; (4) scaffold the repo and confirm the structure with me. Then build Phase 0 — and we go phase by phase, each ending with verification evidence and an adversarial review against this spec.

---

## Appendix A — Schema DDL sketch (refine as needed)

```sql
create type event_type as enum (
  'progress','decision','blocker','spend','next_step',
  'milestone','metric','status_change','github_commit','github_deploy','note'
);
create type event_source as enum ('claude_session','claude_code','github','manual');

create table projects (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  category text not null default 'other',
  goal text,
  repo text,
  live_url text,
  tech_stack text[] default '{}',
  archived boolean not null default false,
  manual_position jsonb,
  created_at timestamptz not null default now()
);

create table events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  ts timestamptz not null default now(),
  type event_type not null,
  summary text not null,
  payload jsonb not null default '{}',
  source event_source not null default 'manual'
);
create index on events (project_id, ts desc);
create index on events (type);

-- project_state, project_metrics, world_spend as views deriving from events.
-- (Implement these views; parameterize an `as_of` variant for time-travel replay.)
```

## Appendix B — MCP tools

```
log_update(project: string, type: string, summary: string, payload?: object)
list_projects()
set_next_step(project: string, text: string)
log_spend(project: string, amount: number, currency: string, vendor?: string, category?: string, note?: string)
```
All call `POST /ingest` server-side with the bearer token from env.

## Appendix C — Standing instruction to paste into my Claude Projects

> You have access to a project-tracker tool (`log_update`, plus `set_next_step` and `log_spend`). Whenever we make meaningful progress on a project — a decision, a spend, a milestone, a blocker, or a clear next step — call the appropriate tool with a concise one-line summary and the correct type. Don't ask permission; log it as a natural side effect of the work. At the end of a substantive session, log a one-line `progress` summary. Use `list_projects` first if you're unsure which project slug to use.

## Appendix D — Environment variables (`.env.example`)

```
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
INGEST_TOKEN=
GITHUB_TOKEN=
GITHUB_USERNAME=vatsal-agra
```

## Appendix E — Claude Code environment setup (optional but recommended)

These reduce friction and catch mistakes automatically during the build:
- **Hooks** (`.claude/settings.json`) — deterministic, run every time: a PostToolUse hook on `Edit|Write` that runs the formatter + typecheck (and lint) so every edit stays clean; a PreToolUse hook on `Bash` that blocks writes/deletes to `.env*`, `secrets/`, and any already-applied migration files.
- **Permissions** — allowlist safe routine commands (`npm run lint`, `npm run test`, `npm run build`, `git status`, `gh pr view`) so you're not prompted constantly; keep destructive commands gated. Consider auto mode for long unattended stretches.
- **Database MCP** — consider `claude mcp add` for a Postgres/Supabase MCP so you can introspect the schema and query data directly while building, instead of guessing.
- **Subagents** — use a fresh subagent for codebase investigation and for the end-of-phase adversarial review, to keep the main context clean.
