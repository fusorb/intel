# Intel — Developer Guide

## Overview

`fusorb/intel` ingests every active Fusorb product repo into a PostgreSQL knowledge graph.
The graph uses six entity types (Repository, Package, Module, Symbol, Document, Decision)
plus a polymorphic Relationship join table. Every row carries full provenance
(sourcePath, sourceCommitSha, retrievedAt, evidenceLevel).

The `Decision` entity captures architectural rules and invariants (e.g. "Facet is the single
mandatory UI system across the ecosystem"). Unlike the other five, `Decision` rows are **not**
extracted by ingestion — they are written by a human (or an agent with review). Their
`sourceType` will almost always be `human_statement`, since they typically originate from
conversation or judgment rather than from a file. Relationship kinds `GOVERNS` and `VIOLATES`
link Decisions to the entities they govern and the entities that currently violate them.

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
│   │       ├── cli.ts
│   │       ├── extract.ts
│   │       ├── graph.ts
│   │       ├── git.ts
│   │       ├── ingest.ts
│   │       ├── index.ts
│   │       ├── parser.ts      # Optional TS/TSX symbol extraction (TypeScript compiler API)
│   │       └── types.ts
│   ├── provider/              # IntelligenceProvider interface + Anthropic implementation
│   ├── retrieval/             # Keyword search, graph traversal, context formatting
│   └── tools/                 # Read-only tool surface (searchRepo, readDocument, etc.)
├── tests/                     # Cross-package acceptance suite + shared setup
├── scripts/verify.ts          # Throwaway validation script (3 acceptance facts)
├── scripts/ask.ts             # Question-answering CLI entry point
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
2. `pnpm -r typecheck` — must pass before commit.
3. `pnpm test` — run the full test suite (unit + integration + acceptance).
4. `pnpm -r build` — must pass (tsup builds each package).
5. If you changed `schemas/graph.prisma`: `pnpm prisma:push` (or `pnpm prisma:generate` if only types changed).
6. Re-ingest repos after code changes: `pnpm ingest:all`.

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
- **Don't build the answering layer yet** — Session 2 covers retrieval/provider/tools/API.
  Focus on ingestion being correct and the graph schema being sound.

## Common tasks

### Ingest a single repo

```bash
pnpm ingest https://github.com/fusorb/facet.git
pnpm ingest https://github.com/fusorb/sovgrant.git --branch main
```

Repos are cloned to `.agent/repos/<name>/` (gitignored). Re-running fetches + resets to HEAD.

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
