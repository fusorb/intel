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
  `REFERENCES`, `GOVERNS`, and `VIOLATES` edge kinds. `DependencyType` enum
  (`dependency`/`dev`/`peer`/`optional`) for dependency edges. `IngestionRun` model tracks
  per-repo ingestion
  counts and status. Provenance on every row. `Decision` entities hold architectural
  rules/invariants and are derived from the architecture repo's vendored ADRs
  (`vendor/fusorb/decisions/*.md`, parsed by `adr.ts`) plus a small hand-authored
  standard-backed remainder — not ingested from the product repos — with `sourceType`
  `human_statement`.
- **Evidence**: `packages/evidence` — the `EvidenceLevel` enum (verified / strongly_supported /
  inferred / unknown) + helpers for attaching provenance.
- **Ingest**: `packages/ingest` — clones a repo via git, walks the file tree, extracts entities
  (packages, modules, documents, **symbols**), and writes to the database. CLI: `pnpm ingest
  <repo-url> [--branch <branch>]`. TS/TSX symbol extraction is wired in via the TypeScript
  compiler API (`parser.ts`, `typescript` as an optional dependency).
- **Retrieval**: `packages/retrieval` — keyword search, graph traversal, context formatting.
- **Provider**: `packages/provider` — `IntelligenceProvider` interface + mock / anthropic /
  ollama / openrouter / openai (generic OpenAI-compatible) implementations.
- **Tools**: `packages/tools` — read-only tool surface + registry (`searchRepo`,
  `readDocument`, `inspectDependencies`, `findSymbol`, `findCallers`, `findReferences`).
- **Agent**: `packages/agent` — multi-step tool-calling loop (`runAgent`) over the provider
  and tool registry; used via `pnpm ask --agent`.
- **API**: `apps/api` — thin, read-only HTTP service (Hono) over the graph, the surface for
  the internal tool at `intel.fusorb.com`. Single-user bearer-token auth by default;
  routes: `/health`, `/ask`, `/ask/agent`, `/search`, `/symbols*`, `/decisions`, `/violations`.
- **Governance**: `packages/ingest` also holds the `Decision` seed — `adr.ts` parses the
  vendored ADRs (`vendor/fusorb/decisions/*.md`), with a small standard-backed remainder in
  `decisions.ts` — plus the governance engine (`governance.ts`): `runGovernance()` upserts
  decisions by stable `key`, prunes any no longer in the seed, writes `GOVERNS` edges, and
  detects `VIOLATES` edges. Run it with `pnpm seed:governance`.
- **CI**: `.github/workflows/ci.yml` (typecheck/build/unit tests, no DB) and
  `.github/workflows/sync.yml` (nightly ingest + seed + verify against a throwaway Postgres).

## Still deferred

- Embedding / hybrid retrieval (not yet in `packages/retrieval`)
- A web UI / architecture explorer (would be built on Facet, per the ecosystem invariant)
- External-contributor access to the graph (current posture is internal-only)

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

# 6. Seed the ADR-derived decisions + governance edges
pnpm seed:governance
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
| `pnpm prisma:migrate` | Apply migrations to a database (`prisma migrate deploy`) |
| `pnpm prisma:generate` | Regenerate Prisma client from schema |
| `pnpm typecheck` | Type-check root (project references) |
| `pnpm -r typecheck` | Type-check every package |
| `pnpm test` | Run the full test suite (unit + integration + acceptance) |
| `pnpm -r build` | Build every package (tsup) |
| `pnpm ingest <url> [--branch <branch>]` | Ingest a single repo |
| `pnpm ingest:all` | Ingest all 4 repos (facet, sovgrant, relnex, sovport) |
| `pnpm ask "<question>" [--agent]` | Ask a question — single-shot, or the multi-step agent |
| `pnpm --filter @fusorb/intel-api dev` | Run the internal read-only API (`apps/api`) |
| `pnpm verify` | Run the throwaway verification script (3 acceptance facts) |
| `pnpm seed:governance` | Seed ADR-derived decisions and (re)compute GOVERNS/VIOLATES edges |
