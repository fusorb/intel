# Intel — Fusorb Knowledge Graph

## What this repo is

`fusorb/intel` is the organization-wide knowledge graph for the Fusorb ecosystem. It ingests
all active product repos (Facet, SovGrant, Relnex, SovPort), extracts structured entities and
relationships into PostgreSQL/Prisma, and tags every fact with provenance and an evidence level.

This repo is **Tier-1 infra**. It is not a product that ships to end users.

## Current scope

- **Graph**: Prisma schema (`schemas/graph.prisma`) — six entity types (Repository, Package,
  Module, Symbol, Document, Decision) + a polymorphic Relationship join table with
  `CONTAINS`, `CONSUMES`, `DEPENDS_ON`, `RENAMED_FROM`, `DOCUMENTS`, `EXPORTS`, `DEFINES`,
  `REFERENCES`, `GOVERNS`, and `VIOLATES` edge kinds. `DependencyType` enum (`PRODUCTION`,
  `DEVELOPMENT`) for dependency edges. `IngestionRun` model tracks per-repo ingestion
  counts and status. Provenance on every row. `Decision` entities hold architectural
  rules/invariants and are written by humans/agents (not ingested), with `sourceType`
  almost always `human_statement`.
- **Evidence**: `packages/evidence` — the `EvidenceLevel` enum (verified / strongly_supported /
  inferred / unknown) + helpers for attaching provenance.
- **Ingest**: `packages/ingest` — clones a repo via git, walks the file tree, extracts entities
  (packages, modules, documents, **symbols**), and writes to the database. CLI: `pnpm ingest
  <repo-url> [--branch <branch>]`. TS/TSX symbol extraction is wired in via the TypeScript
  compiler API (`parser.ts`, `typescript` as an optional dependency).
- **Retrieval**: `packages/retrieval` — keyword search, graph traversal, context formatting.
- **Provider**: `packages/provider` — `IntelligenceProvider` interface + Anthropic implementation.
- **Tools**: `packages/tools` — read-only tool surface (`searchRepo`, `readDocument`,
  `inspectDependencies`).

## Still deferred

- `find_symbol`, `find_callers`, `find_references` tools (not yet in `packages/tools`)
- Embedding / hybrid retrieval (not yet in `packages/retrieval`)
- The agentic multi-step tool-calling loop
- `apps/api` — any API/console surface
- Any UI

## Quick start

```bash
# 1. Install dependencies (postinstall runs prisma generate)
pnpm install

# 2. Start PostgreSQL (data dir: C:\Users\HP\pgdata\Intel, port 5433, trust auth)
#    pg_ctl -D "C:\Users\HP\pgdata\Intel" -o "-c port=5433" -l "C:\Users\HP\pgdata\Intel/pg.log" start
#    createdb -h 127.0.0.1 -p 5433 -U postgres intel

# 3. Push schema to database
pnpm prisma:push

# 4. Ingest all four repos
pnpm ingest:all

# 5. Verify the three acceptance facts
pnpm verify
```

## Key files

| Path | Purpose |
|------|---------|
| `schemas/graph.prisma` | Canonical Prisma schema — six entities + Relationship |
| `packages/evidence/src/index.ts` | `EvidenceLevel` enum + provenance helpers |
| `packages/graph/src/index.ts` | PrismaClient singleton + re-exports |
| `packages/ingest/src/` | Ingestion library (`index.ts`) + CLI (`cli.ts`) + optional TS/TSX parser (`parser.ts`) |
| `prisma.config.ts` | Prisma config pointing to `schemas/graph.prisma` |

## Architecture

```
┌─────────────────┐  writes ───► ┌─────────────────────┐
│   ingest (git)  │             │     PostgreSQL        │
│  clones + walks │             │  (schema: graph.prisma)│
│  package.json,  │             │                       │
│  dirs, .md      │             │  Repository ◄──┐     │
└────────┬────────┘             │  Package        │     │
         │                      │  Module         │     │
         │ uses                 │  Symbol         │     │
         ▼                      │  Document       │     │
         │                      │  Decision       │     │
┌────────────────┐            │  Relationship ──┘     │
│     graph      │            │  (polymorphic join)   │
│ (Prisma client)│───────────►│  + provenance         │
└────────┬────────┘            └─────────────────────┘
         │
         │ re-exports
         ▼
┌────────────────┐
│   evidence     │
│ (EvidenceLevel)│
└────────────────┘
```

## Commands

| Command | What it does |
|---------|-------------|
| `pnpm install` | Install all dependencies (runs `prisma generate` via postinstall) |
| `pnpm prisma:push` | Push schema to local Postgres (`intel` DB) |
| `pnpm prisma:generate` | Regenerate Prisma client from schema |
| `pnpm typecheck` | Type-check root (project references) |
| `pnpm -r typecheck` | Type-check every package |
| `pnpm test` | Run the full test suite (unit + integration + acceptance) |
| `pnpm -r build` | Build every package (tsup) |
| `pnpm ingest <url> [--branch <branch>]` | Ingest a single repo |
| `pnpm ingest:all` | Ingest all 4 repos (facet, sovgrant, relnex, sovport) |
| `pnpm verify` | Run the throwaway verification script (3 acceptance facts) |
