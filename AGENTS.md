# Intel — Developer Guide

## Overview

`fusorb/intel` ingests every active Fusorb product repo into a PostgreSQL knowledge graph.
The graph uses six entity types (Repository, Package, Module, Symbol, Document, Decision)
plus a polymorphic Relationship join table. Every row carries full provenance
(sourcePath, sourceCommitSha, retrievedAt, evidenceLevel).

The `Decision` entity captures architectural rules and invariants (e.g. "Facet is the single
mandatory UI system across the ecosystem"). Unlike the other five, `Decision` rows are **not**
extracted from the product repos — they are derived from the architecture repo's own ADRs,
vendored under `vendor/fusorb/decisions/*.md` (9 ADRs, `0001`–`0009`) and parsed by
`packages/ingest/src/adr.ts`, plus a small hand-authored remainder in
`packages/ingest/src/decisions.ts` (`STANDARD_DECISIONS`) for standards no ADR covers. They are
written to the graph by `runGovernance()` (`pnpm seed:governance`). Their `sourceType` is
`human_statement`, since they originate from the ecosystem's authored decisions rather than from
an ingested product-repo file. Relationship kinds `GOVERNS` and `VIOLATES` link Decisions to the
entities they govern: `GOVERNS` edges are seeded alongside the decisions, and `VIOLATES` edges
are detected from the live graph.

## Tech stack

- **Language**: TypeScript strict, ESM
- **Package manager**: pnpm 12 (workspaces, `packages/*` layout)
- **Build**: tsup (esm + dts), typecheck via `tsc --noEmit`
- **Database**: PostgreSQL 18, Prisma 7
- **Prisma client**: `@prisma/adapter-pg` + `pg` Pool (matches SovGrant pattern)
- **CLI**: `commander` (matches Facet CLI convention)
- **Git**: native `git` CLI via `node:child_process` (avoids GitHub API rate limits)

## Project structure

```
fusorb/intel
├── schemas/graph.prisma       # Canonical Prisma schema (committed, source of truth)
├── prisma.config.ts           # Prisma 7 config (schema path)
├── vitest.config.ts           # Test runner config
├── packages/
│   ├── evidence/              # EvidenceLevel enum + provenance helpers (thin, no deps)
│   ├── graph/                 # Prisma client singleton + re-exports
│   ├── ingest/                # Repo cloning, file-tree walking, entity extraction, CLI
│   │   └── src/
│   │       ├── adr.ts         # Parses vendored architecture-repo ADRs (vendor/fusorb/decisions) into Decision seeds
│   │       ├── cli.ts
│   │       ├── decisions.ts   # Decision seeds: ADR-derived + standard-backed remainder
│   │       ├── extract.ts
│   │       ├── governance.ts  # runGovernance(): seed decisions, write GOVERNS/VIOLATES
│   │       ├── graph.ts
│   │       ├── git.ts
│   │       ├── ingest.ts
│   │       ├── index.ts
│   │       ├── parser.ts      # TS/TSX symbol + call-reference extraction (TypeScript compiler API)
│   │       └── types.ts
│   ├── provider/              # IntelligenceProvider + mock/anthropic/ollama/openrouter/openai
│   ├── retrieval/             # Keyword search, graph traversal, symbol lookup, context formatting
│   ├── tools/                 # Read-only tool surface + registry (searchRepo, findSymbol, ...)
│   └── agent/                 # Agentic multi-step tool-calling loop (runAgent)
├── apps/
│   └── api/                   # Internal read-only HTTP service (Hono) → intel.fusorb.com
├── tools/consumer/            # Vendored snapshot sync/check (sync-fusorb.mjs + profiles.json + README.md)
├── vendor/fusorb/             # Vendored architecture-repo snapshot (ADRs, standards, PROVENANCE.json)
├── tests/                     # Cross-package acceptance suite + shared setup
├── scripts/seed-governance.ts # `pnpm seed:governance`
├── scripts/verify.ts          # Acceptance script (3 acceptance facts); gates the nightly sync job
├── scripts/ask.ts             # Question-answering CLI entry point
├── .github/workflows/         # ci · sync · image · anthropic-wif-test
├── CLAUDE.md                  # Agent-facing instructions
├── AGENTS.md                  # This file
└── .agent/                    # Gitignored scratch (repo clones, outputs, logs)
```

## Setup

```bash
# Install deps (postinstall runs `prisma generate`)
pnpm install

# Start PostgreSQL (Windows, data dir pre-initialized)
pg_ctl -D "C:\Users\HP\pgdata\Intel" -o "-c port=5433" -l "C:\Users\HP\pgdata\Intel/pg.log" start
createdb -h 127.0.0.1 -p 5433 -U postgres intel

# Push schema
pnpm prisma:push
```

## Daily workflow

1. Make your changes.
2. `pnpm typecheck` — type-checks every package **and** `tests/`; must pass before commit.
3. `pnpm test` — run the full test suite (unit + integration + acceptance).
4. `pnpm -r build` — must pass (tsup builds each package).
5. If you changed `schemas/graph.prisma`: `pnpm prisma:push` (or `pnpm prisma:generate` if only types changed).
6. Re-ingest repos after code changes: `pnpm ingest:all`.
7. Re-seed decisions and governance after ingest or seed changes: `pnpm seed:governance`.
8. If the architecture repo moved: `pnpm check:freshness` (needs `FUSORB_DIR`), then
   `pnpm sync:fusorb --from <fusorb>` — see "Re-sync the vendored snapshot" below.

## Continuous integration

- `.github/workflows/ci.yml` — `check:fusorb` + typecheck + build + unit tests on push/PR. No database, so DB-backed tests self-skip. `check:fusorb` is the *offline* snapshot check: it proves `vendor/fusorb/` matches `PROVENANCE.json` and needs nothing but this repo.
- `.github/workflows/sync.yml` — nightly (and on demand): provisions a disposable Postgres, runs `prisma db push` + `ingest:all` + `seed:governance` + `verify` + the full suite. Fails when a **product** repo drifts; it does not see architecture-repo drift (that is `check:freshness`, which needs a fusorb clone).
- `.github/workflows/image.yml` — on push to `main` (paths that affect the service): builds the `Dockerfile` and pushes `ghcr.io/fusorb/intel/intel-api`.

## Conventions to follow

- **TypeScript strict** — no `any`, always type your function params and returns.
- **ESM only** — no CommonJS. Use `import`/`export`, never `require`.
- **Provenance is mandatory** — every DB write must set `sourcePath`, `sourceCommitSha`,
  `retrievedAt`, and `evidenceLevel`. This is not optional metadata.
- **Evidence levels** — use `EvidenceLevel.verified` for data read directly from files,
  `EvidenceLevel.strongly_supported` for backed by strong but indirect evidence,
  `EvidenceLevel.inferred` for derived/inferred facts (e.g. dependency edges),
  `EvidenceLevel.unknown` for unassessed.
- **No speculative entities** — the schema has exactly six entity types (Repository, Package,
  Module, Symbol, Document, Decision). Don't add more unless the verification step proves
  they're needed.
- **The answering layer is implemented** — `packages/retrieval`, `packages/provider`,
  `packages/tools`, and `packages/agent` are all present, and `apps/api` is the internal
  read-only HTTP service over them. The agentic multi-step tool-calling loop runs via
  `pnpm ask --agent`, with `find_symbol`, `find_callers`, and `find_references` backed by
  REFERENCES call-graph edges extracted at ingest time. Still deferred: embedding/hybrid
  retrieval and any web UI.

## Common tasks

### Ingest a single repo

```bash
pnpm ingest https://github.com/fusorb/facet.git
pnpm ingest https://github.com/fusorb/sovgrant.git --branch main
```

Repos are cloned to `.agent/repos/<name>/` (gitignored). Re-running fetches + resets to HEAD.

### Seed decisions and governance

Decisions are not extracted from the product repos. Most are derived from the architecture
repo's own ADRs, vendored under `vendor/fusorb/decisions/*.md` and parsed by
`packages/ingest/src/adr.ts`: the ADR filename slug becomes the stable `key`, the H1 (leading
`N. ` ordinal stripped) the title, the verbatim `## Decision` section the statement, and the
frontmatter supplies `status`/`governs` (`governs` ids are filtered to those present in
`vendor/fusorb/ecosystem.json`), with `sourceCommitSha` from `vendor/fusorb/PROVENANCE.json`. The
small hand-authored remainder in `packages/ingest/src/decisions.ts` (`STANDARD_DECISIONS`) covers
the standards no ADR exists for. Edit the ADRs upstream and re-sync, or edit the standard-backed
seeds, then run:

```bash
pnpm seed:governance
```

`runGovernance()` upserts each decision by its stable `key`, **prunes** any Decision no longer in
the seed (deleting its relationships first), writes a `GOVERNS` edge to every
Repository/Package/Module it governs, then detects `VIOLATES` edges (retired `@arcevo/*` scope,
shadcn-style UI deps, missing `AGENTS.md`/`CLAUDE.md`). It is idempotent and clears violations
that no longer hold — re-run it after `pnpm ingest:all`.

### Re-sync the vendored snapshot

`vendor/fusorb/` is a snapshot of `poetic-dev/fusorb` pinned in
`vendor/fusorb/PROVENANCE.json`. The pinned commit is what `decisions.ts`/`adr.ts` stamp onto
seeded Decisions, so a stale snapshot means stale decision provenance. The tool lives in
`tools/consumer/` (see its `README.md`).

```bash
# 1. Is the snapshot current? (freshness needs a fusorb clone)
set FUSORB_DIR=C:\Users\HP\Desktop\poetic-dev\fusorb     # or export, or --from <path>
pnpm check:freshness

# 2. Re-vendor from the pushed commit, then re-check and re-seed
pnpm sync:fusorb --from "C:\Users\HP\Desktop\poetic-dev\fusorb"
pnpm check:fusorb
pnpm seed:governance
```

Profiles select what is vendored; the `intel` profile uses directory entries (`decisions/`,
`content/standards/`, `scripts/lib/`), so a new ADR or standard is picked up without editing
`profiles.json`. A new ADR changes the decision set, which the assertions in
`packages/ingest/test/adr.test.ts` pin deliberately — expect to update them when one lands.

### Query the graph manually

```bash
pnpm prisma:studio    # web UI at http://localhost:5555
# or
pnpm exec tsx -e 'import { prisma } from "@fusorb/intel-graph"; console.log(await prisma.repository.findMany())'
```

### Run tests

```bash
pnpm test                                     # full suite (unit + integration + acceptance)
pnpm test packages/ingest/test/parser.test.ts # single test file
```

Tests live next to their source files under `packages/*/test/`. Cross-cutting
acceptance tests live in `tests/suite.test.ts`. The `DATABASE_URL` environment
variable is loaded from `.env` by `tests/setup.ts`.

### Run verification

```bash
pnpm verify   # checks 3 acceptance facts from real data
```
