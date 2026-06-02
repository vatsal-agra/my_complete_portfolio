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
