# Project World — Claude Code rules

Full design lives in `PROJECT_SPEC.md`. Re-read the relevant section at the start of each phase; don't duplicate spec content here.

## Invariants
- **Events are append-only.** Never UPDATE or DELETE rows in `events`. All current state is *derived* (views / SQL functions). Mutating an event is a bug.
- **Secrets in env vars only.** Never hardcode or commit Supabase keys, `INGEST_TOKEN`, or `GITHUB_TOKEN`. Keep `.env*` gitignored — only `.env.example` is committed.
- **Public read-only mode is enforced at the database layer.** Supabase RLS must hide sensitive fields (spend amounts, decision/blocker/note content) from the anon role. Never rely on the UI alone for privacy.
- **Verify before declaring done.** Each phase has success criteria — produce evidence (test output, command transcript, screenshot). If you can't verify it, it isn't done.
- **Phase by phase.** Don't build ahead. End each phase with an adversarial subagent review against `PROJECT_SPEC.md`, then pause for review.

## Workflow
- Use `/clear` between phases; re-read `PROJECT_SPEC.md` + the current phase's section at the start.
- Use the `gh` CLI for all GitHub operations.
- Free-tier friendly; lean, well-maintained deps only.
- Prefer the simplest thing that satisfies the current phase's success criteria.

## Code style
- TypeScript everywhere, `strict: true`, ESM (`"type": "module"`).
- Node 20+.
- Named exports only for shared modules.

## Scope boundary

- Work only within this project folder and its subdirectories.
- Do not read or edit files outside this folder. Other projects are siblings above this
  directory and are off-limits.
- If a task seems to require something outside this folder, stop and ask me. Do not reach
  for it on your own (including via shell commands with `../` or absolute paths).

## Memory protocol

The `claude-memory/` folder is your persistent memory across sessions. Use it so you don't
have to re-explore the whole codebase every time — that re-exploration is the expensive part
we're trying to avoid.

### First time in this project (if `claude-memory/` does not exist yet)

1. Create the folder structure shown under "Memory folder layout" below.
2. Do ONE pass over the project to understand it, then seed `overview.md` (architecture,
   stack, key decisions) and `state.md` (current status, next actions) from what you find.
3. Tell me you've initialized memory, and confirm the summary is accurate before continuing.

### At the START of every session

1. Read `claude-memory/overview.md` — architecture, stack, and the *why* behind decisions.
2. Read `claude-memory/state.md` — where things stand and the next actions.
3. Skim the most recent file in `claude-memory/sessions/` for what happened last time.
4. Rebuild your understanding from these notes. Only open source files when a specific task
   actually requires reading or editing them — not to re-learn the project.

### DURING the session

- Treat the memory notes as the source of truth for *why* things are the way they are.
- If you find the notes are stale or wrong, flag it to me and fix them.

### At the END of a session (when I say we're wrapping up or ask for a summary)

1. **Search before you save.** Check whether `overview.md` or `state.md` already cover what
   changed. Update those files in place — never create a near-duplicate note.
2. Update `state.md` to reflect the new current status and a clear list of next actions.
3. If an architectural or design decision was made, record it (with the reasoning) in
   `overview.md`.
4. Write a short dated summary to `claude-memory/sessions/YYYY-MM-DD-brief-topic.md`:
   what we did, what changed, what's still open. Bullets, not prose. Keep it tight.
5. Keep memory lean. It's a digest, not a transcript. Summarize; don't accumulate.

## Memory folder layout

```
claude-memory/
├── overview.md     # stable:   architecture, stack, decisions + why
├── state.md        # volatile: current status + next actions
└── sessions/       # appended: dated session summaries
```
