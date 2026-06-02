# Project World

Event-sourced "living world" portfolio canvas. See [PROJECT_SPEC.md](PROJECT_SPEC.md) for the full design and [CLAUDE.md](CLAUDE.md) for the hard invariants.

> **Phase 0 in progress** — backend spine (database + `POST /ingest` + MCP server). No frontend yet.

## Quickstart

```bash
pnpm install
pnpm db:push        # apply migrations to the linked Supabase project
pnpm dev            # start the Hono HTTP server on http://localhost:8787
pnpm test           # vitest unit tests
pnpm verify         # live integration smoke test against the cloud DB
pnpm mcp:stdio      # run the MCP server over stdio (for local Claude Code)
```

Copy `.env.example` to `.env.local` and fill in the values.

## Pushing an update via `curl`

```bash
curl -X POST http://localhost:8787/ingest \
  -H "Authorization: Bearer $INGEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"project":"mockmate","type":"progress","summary":"Polished onboarding flow"}'
```

Or use the web form at `http://localhost:8787/ingest-form` (paste the token once; it's kept in `localStorage`).
