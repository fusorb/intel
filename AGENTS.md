# Intel — Developer Guide

## Overview

`fusorb/intel` ingests every active Fusorb product repo into a PostgreSQL knowledge graph.
The graph uses five entity types (Repository, Package, Module, Symbol, Document) plus a
polymorphic Relationship join table. Every row carries full provenance
(sourcePath, sourceCommitSha, retrievedAt, evidenceLevel).

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
├── schemas/graph.prisma       # Canonical Prisma schema (committed)
├── prisma.config.ts           # Prisma 7 config (schema path)
├── packages/
│   ├── evidence/              # EvidenceLevel enum + provenance helpers (thin, no deps)
│   ├── graph/                 # Prisma client singleton + re-exports
│   └── ingest/                # Repo cloning, file-tree walking, entity extraction, CLI
├── scripts/verify.ts          # Throwaway validation script (3 acceptance facts)
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
3. `pnpm -r build` — must pass (tsup builds each package).
4. If you changed `schemas/graph.prisma`: `pnpm prisma:push` (or `pnpm prisma:generate` if only types changed).
5. Re-ingest repos after code changes: `pnpm ingest:all`.

## Conventions to follow

- **TypeScript strict** — no `any`, always type your function params and returns.
- **ESM only** — no CommonJS. Use `import`/`export`, never `require`.
- **Provenance is mandatory** — every DB write must set `sourcePath`, `sourceCommitSha`,
  `retrievedAt`, and `evidenceLevel`. This is not optional metadata.
- **Evidence levels** — use `EvidenceLevel.Verified` for data read directly from files,
  `EvidenceLevel.Inferred` for derived/inferred facts, `EvidenceLevel.Unknown` for unassessed.
- **No speculative entities** — the schema has exactly five entity types. Don't add more
  unless the verification step proves they're needed.
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

### Run verification

```bash
pnpm verify   # checks 3 acceptance facts from real data
```
