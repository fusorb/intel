# Fusorb Intel

The knowledge graph for the Fusorb ecosystem.

Intel ingests every active Fusorb product repository (Facet, SovGrant, Relnex, SovPort) into a
PostgreSQL graph, extracts structured entities and relationships, and tags every fact with
provenance and an evidence level. It is **tier-1 infrastructure** — the durability layer that
records *what is*, *where it was seen*, *how confidently*, and *when*. It is not a product that
ships to end users.

---

## What it does

At its core, Intel performs three jobs:

1. **Ingest** — clones a Fusorb repo via native `git`, walks the full file tree, and extracts
   structured entities (packages, modules, documents) along with their dependency relationships.
2. **Record** — persists those entities and relationships into PostgreSQL/Prisma, with every row
   carrying provenance: the source file path, the exact commit SHA, a timestamp, and an
   evidence level.
3. **Verify** — answers cross-repo questions with citations and correct uncertainty. "I don't know"
   is an acceptable answer when the graph has no evidence; "it depends on when you asked" is the
   correct answer when facts have drifted across time.

### Why this matters

The Fusorb ecosystem is a collection of specialized, domain-owned repositories that evolve
independently. Naming drift, scope lag, and cross-repo architectural violations are real and
common — for example:

- Repos were renamed from Arc-names (ArcUI → Facet, ArcID → SovGrant, ArcBase → Relnex,
  ArcWallet → SovPort) at the GitHub/org level, but **every internal document** still uses the
  old names.
- SovGrant's frontend still imports `@arcevo/facet-*` (the old npm scope) instead of
  `@fusorb/facet-*` — a deliberate, roadmapped migration that hasn't completed yet.
- Relnex builds its UI with shadcn/ui instead of `@fusorb/facet-*`, violating the stated ecosystem
  invariant that Facet is the single mandatory UI system.

Intel exists to catch exactly this kind of drift — and to make honest, citable, time-aware
statements about it, rather than guessing.

---

## Architecture

### The graph model

The schema (`schemas/graph.prisma`) defines six entity models plus a polymorphic `Relationship`
join table:

| Entity | What it captures | Example |
|---|---|---|
| **Repository** | A cloned Fusorb repo | `facet`, `sovgrant`, `relnex`, `sovport` |
| **Package** | A `package.json` within a repo | `@fusorb/facet-components`, `@fusorb/facet-auth` |
| **Module** | A source directory containing `.ts`/`.tsx`/`.js`/`.jsx` files | `packages/components/src`, `src/domains/auth` |
| **Symbol** | A named declaration in source (table exists, extraction available via TypeScript parser boundary) | `useAuth`, `handleApiRoute` |
| **Document** | A Markdown/MDX file | `README.md`, `docs/architecture.md` |
| **Decision** | A recorded rule, invariant, or architectural decision (written by humans or agents, not ingested) | "Facet is the single mandatory UI system across the ecosystem" |

**Relationships** link entities with typed edges:

| Kind | Meaning |
|---|---|
| `CONTAINS` | Repository contains a Package, Module, or Document |
| `CONSUMES` | Package A depends on Package B (synthesized from `package.json`) |
| `DEPENDS_ON` | Module or Symbol depends on another |
| `RENAMED_FROM` | Entity renamed from another (the Arc→current-name lineage) |
| `DOCUMENTS` | Document describes another entity |
| `EXPORTS` | Module exports a Symbol |
| `DEFINES` | Module or Symbol defines a Symbol |
| `REFERENCES` | Symbol references another Symbol |
| `GOVERNS` | Decision governs a Repository, Package, or Module |
| `VIOLATES` | Entity currently violates a Decision |

### Evidence and provenance

Every fact-bearing row carries these provenance fields:

- **`sourcePath`** — where the fact was observed (a file path in the ingested repo, `"npm"` for
  the synthetic npm registry, `"npm:@fusorb/facet-components"` for an external package)
- **`sourceType`** — how the fact was obtained: `file`, `commit`, `human_statement`, or
  `inferred_pattern`
- **`sourceCommitSha`** — the exact commit the data was read at (nullable for human-sourced or
  never-ingested facts)
- **`firstSeenAt`** — when the row was first created
- **`retrievedAt`** — updated on every re-ingest, so the graph always reflects "as of" a known point
- **`evidenceLevel`** — confidence, independent of *how* it was observed:
  - `verified` — read directly from a file (the highest bar)
  - `strongly_supported` — backed by strong evidence but not a direct file read
  - `inferred` — a derived or synthesized fact (e.g. a dependency edge inferred from a
    `package.json`, or an external package placeholder synthesized to host a CONSUMES edge)
  - `unknown` — not yet assessed
- **`removedAt`** — soft-delete timestamp; set when a re-ingest no longer finds the entity

This means two documents that disagree (e.g., SovGrant's README says 342 tests, its v2 roadmap says
358, and SovPort's integration plan cites 326 from an older `.agent/output.txt`) are **all recorded
with their timestamps**, not collapsed into a single "current" number. The graph answers "as of
2026-09-01, per the v2 roadmap: 358" rather than guessing.

### Ingestion pipeline

The ingestion flow (`packages/ingest/src/ingest.ts`):

```
git clone/fetch ──► file-tree walk ──► entity extraction ──► DB upsert ──► relationship sync
```

1. **Clone or fetch** — `git clone --quiet --no-tags --depth=1` for new repos; `git fetch --prune`
   + `git reset --hard` for re-ingests. The SHA at HEAD is captured as the commit context.
2. **Walk the tree** — skips `.git`, `node_modules`, `dist`, `.next`, `coverage`, etc. Identifies
   directories that contain source files (modules) and directories that contain `package.json`
   (packages).
3. **Extract entities** — reads each `package.json` (name, version, description, dependencies,
   devDependencies), each source directory (module), and each Markdown file (document, with title
   and first non-empty line as description).
4. **Persist with upsert** — for packages, modules, and documents; each write carries provenance
   tied to the current commit SHA.
5. **Sync relationships** — writes `CONTAINS` edges from the repository to every entity, and
   `CONSUMES` edges from each package to its declared dependencies. External dependencies not found
   in any ingested repo are placed under a synthetic `npm` repository as placeholder entities with
   `inferred` evidence level.

Re-ingests are idempotent: stale entities are soft-deleted (`removedAt` set) before the current set
is refreshed, so the graph always converges to "as of" the latest commit.

### Symbol extraction boundary

Intel ingests **file-structure-level** data as the default — package manifests, directory structure, and
document files. Symbol-level extraction is available via an **opt-in TypeScript compiler API parser**
(`packages/ingest/src/parser.ts`) that handles `.ts`/`.tsx` files. The parser is opt-in: if the
`typescript` package is not present, symbol extraction is skipped gracefully with a non-fatal error
recorded on the result. Integration into the full ingestion pipeline is staged — the extraction
boundary is ready and tested, but `linkSymbols` is not yet called from the main `ingest.ts`
orchestration.

---

## Project structure

```
fusorb/intel/
├── schemas/
│   └── graph.prisma              # Canonical Prisma schema (committed, source of truth)
├── packages/
│   ├── evidence/                 # EvidenceLevel enum + provenance helpers (zero deps)
│   │   └── src/index.ts
│   ├── graph/                    # PrismaClient singleton + re-exports
│   │   └── src/index.ts
│   └── ingest/                   # Git clone, file-tree walk, entity extraction, CLI
│       └── src/
│           ├── cli.ts            # CLI entry: `pnpm ingest <url> [--branch <branch>]`
│           ├── extract.ts        # File-tree walker + entity parser
│           ├── graph.ts          # DB upsert layer (provenance on every write)
│           ├── git.ts            # git CLI wrappers (cloneOrFetch, currentCommit, etc.)
│           ├── ingest.ts         # Orchestration: clone → extract → persist → link
│           ├── index.ts          # Public re-exports
│           ├── parser.ts         # Optional TS/TSX symbol extraction (TypeScript compiler API)
│           └── types.ts          # Extracted entity interfaces
│   ├── provider/                 # IntelligenceProvider interface + Anthropic implementation
│   │   └── src/index.ts
│   ├── retrieval/                # Keyword search, graph traversal, context formatting
│   │   └── src/index.ts
│   └── tools/                    # Read-only tool surface (searchRepo, readDocument, inspectDependencies)
│       └── src/index.ts
├── prisma.config.ts              # Prisma 7 config (schema path, datasource URL)
├── scripts/
│   ├── postinstall.cjs           # Runs `prisma generate` on install
│   ├── verify.ts                 # Throwaway script: asserts 3 acceptance facts from real data
│   └── ask.ts                    # Question-answering CLI: `pnpm ask "<question>"`
├── tsconfig.base.json            # Shared TypeScript strict config
├── tsconfig.json                 # Root project references
├── pnpm-workspace.yaml           # pnpm workspaces config
├── .env                          # Local environment (gitignored)
└── .agent/                       # Gitignored scratch (repo clones, outputs, logs)
```

### Packages at a glance

| Package | Role |
|---|---|
| `@fusorb/intel-evidence` | The `EvidenceLevel` enum and provenance type/helpers. Zero runtime dependencies. Imported by `graph` and re-exported, so any consumer can `import { EvidenceLevel } from "@fusorb/intel-graph"`. |
| `@fusorb/intel-graph` | PrismaClient singleton (with `pg` Pool via `@prisma/adapter-pg`, matching the SovGrant pattern) plus re-exports of evidence vocabulary. |
| `@fusorb/intel-ingest` | The ingestion library and CLI. Depends on `graph` and `evidence`. The TypeScript parser (`parser.ts`) is opt-in — `typescript` is an optional dependency, gracefully handled when absent. |
| `@fusorb/intel-provider` | `IntelligenceProvider` interface + Anthropic-hosted model implementation, with citation extraction and unsourced-claim checks. |
| `@fusorb/intel-retrieval` | Keyword search across all entity types, graph traversal (CONSUMES/dependents/CONTAINS), document reading, and `formatContext` for assembling prompt context. |
| `@fusorb/intel-tools` | Read-only tool surface wrapping retrieval: `searchRepo`, `readDocument`, `inspectDependencies`. |

---

## Setup

### Prerequisites

- **Node.js** >= 22
- **pnpm** 12.4.0
- **PostgreSQL** 18

### Installation

```bash
pnpm install
```

The `postinstall` script runs `prisma generate` to produce the typed client. It also sets
`PRISMA_SKIP_ENGINE_DOWNLOAD=true` in-process — this project talks to PostgreSQL via the
`@prisma/adapter-pg` driver adapter, so the Prisma query engine binary is never required.

### Database

Start PostgreSQL and create the `intel` database:

```bash
# Start PostgreSQL (data dir pre-initialized on Windows)
pg_ctl -D "C:\Users\HP\pgdata\Intel" -o "-c port=5433" -l "C:\Users\HP\pgdata\Intel/pg.log" start

# Create the database
createdb -h 127.0.0.1 -p 5433 -U postgres intel
```

Set `DATABASE_URL` in `.env` (example):

```
DATABASE_URL="postgresql://postgres@localhost:5433/intel?schema=public"
PRISMA_SKIP_ENGINE_DOWNLOAD=true
```

Push the schema:

```bash
pnpm prisma:push
```

---

## Usage

### Ingest a single repo

```bash
pnpm ingest https://github.com/fusorb/facet.git
pnpm ingest https://github.com/fusorb/sovgrant.git --branch main
```

Repos are cloned to `.agent/repos/<name>/` (gitignored). Re-running fetches, resets to HEAD, and
soft-deletes stale entities — the graph always converges to the current commit.

### Ingest all four repos

```bash
pnpm ingest:all
```

### Query the graph

```bash
# Web UI
pnpm prisma:studio

# Quick check from the shell
pnpm exec tsx -e 'import { prisma } from "@fusorb/intel-graph"; console.log(await prisma.repository.findMany())'
```

### Verify acceptance facts

```bash
pnpm verify
```

This throwaway script (`scripts/verify.ts`) asserts three facts from real data:

1. SovGrant's manifests reference `@arcevo/facet-*` (not `@fusorb/facet-*`).
2. Facet ships Package entities for `packages/motion`, `packages/native`, and `packages/sandbox`.
3. Relnex depends on shadcn-related packages (not `@fusorb/facet-components`).

### Asking questions

Intel answers natural-language questions about the graph end-to-end through retrieval + provider:

```bash
pnpm ask "Why does SovGrant's frontend import @arcevo/facet-sdk instead of @fusorb/facet-sdk?"
```

`scripts/ask.ts` performs a single retrieval pass over the graph, formats the results with
provenance into a prompt, and sends it to a hosted model via `packages/provider`. Every factual
claim in the answer is cited inline as `[source: <sourcePath>, commit: <sourceCommitSha>]`, and
the provider runs a post-generation check that flags unsourced claims or citations whose
`sourcePath` doesn't appear in the retrieved context. Follow-up questions automatically reuse the
previous retrieval's context (`.agent/ask-context.txt`), so you can ask "When was that fact last
confirmed?" and get a time-aware answer.

---

## Development workflow

1. Make your changes.
2. `pnpm -r typecheck` — type-check every package (must pass).
3. `pnpm -r build` — build every package with tsup (must pass).
4. `pnpm test` — run the full test suite (unit + integration + acceptance).
5. If you changed `schemas/graph.prisma`: `pnpm prisma:push` to sync the database
   (or `pnpm prisma:generate` if only types changed).
6. Re-ingest repos after schema or code changes: `pnpm ingest:all`.
7. Re-run verification: `pnpm verify`.

### Conventions

- **TypeScript strict** — no `any`; always type function params and returns.
- **ESM only** — `import`/`export`, never `require`.
- **Provenance is mandatory** — every database write must set `sourcePath`, `sourceCommitSha`,
  `retrievedAt`, `sourceType`, and `evidenceLevel`.
- **Evidence levels** — `verified` for data read directly from files; `inferred` for derived facts
  (e.g. dependency edges); `strongly_supported` when backed by strong but indirect evidence;
  `unknown` for unassessed.
- **Source types** — `file` for data read from a file; `commit` for commit-level facts;
  `human_statement` for facts from conversation or judgment (e.g. the npm-namespace blocker);
  `inferred_pattern` for synthesized patterns (e.g. the synthetic `npm` repository).
- **Soft deletes** — re-ingests mark stale entities with `removedAt` rather than hard-deleting, so
  the graph retains a full history of what was removed and when.
- **Idempotent upserts** — `Repository`, `Package`, `Module`, `Document`, and `Relationship` are
  all upserted by natural key, not appended. Re-ingesting the same commit produces no duplicates.

---

## The Fusorb ecosystem in brief

Intel ingests these four product repositories:

| Repo | Role | Current state |
|---|---|---|
| **[facet](https://github.com/fusorb/facet)** | Domain-customizable, auth-first UI component system | Mature — 12 packages, 114 components, the canonical UI layer for the ecosystem |
| **[sovgrant](https://github.com/fusorb/sovgrant)** | Sovereign, multi-tenant identity/access/credentials engine | v1 complete — full OAuth2, SD-JWT, SAML/OIDC federation, 19 permissions |
| **[relnex](https://github.com/fusorb/relnex)** | Knowledge-graph content management | Early/mid — rebuild in progress, auth fully delegated to SovGrant |
| **[sovport](https://github.com/fusorb/sovport)** | Self-sovereign identity wallet (credential holder) | Pre-integration scaffold — fully specified 4-phase plan against SovGrant's SDK |

### What Intel ingests from each

- **package.json files** → Package entities with real and dev dependency maps
- **source directories** (anything with `.ts`/`.tsx`/`.js`/`.jsx`) → Module entities
- **Markdown files** (`.md`, `.mdx`, `.markdown`) → Document entities with title + summary
- **Dependency declarations** → CONSUMES relationship edges (with semver range as the `note`)
- **Repository → entity containment** → CONTAINS relationship edges

### What Intel surfaces

Because every fact carries its commit SHA and timestamp, Intel can answer questions like:

- *"Why does SovGrant import `@arcevo/facet-sdk` instead of `@fusorb/facet-sdk`?"*
  → SovGrant's `package.json` shows `@arcevo/facet-sdk` as a dependency. The discrepancy is real,
  deliberate, and roadmapped — but Intel cannot answer *why* the npm-org namespace is blocked,
  because no ingested document states the reason. It would correctly report that as `unknown`.
- *"How many tests does SovGrant have?"*
  → Intel surfaces **all** numbers with their dates: 358 (as of 2026-09-01, per the v2 roadmap),
  342 (per the README), 326 (as of 2026-08-05, per SovPort's integration plan). A single-snapshot
  answer would be wrong; the graph captures the full picture.
- *"Does Relnex use Facet for its UI?"*
  → Relnex's dependencies include shadcn-related packages (`@radix-ui/*`, `lucide-react`,
  `clsx`, `tailwind-merge`) and do **not** include `@fusorb/facet-components`. This is a verified
  violation of the "Facet is the only UI system" architectural decision.

---

## Deferred (future sessions)

- **`apps/api`** — any API or console surface. An eventual thin `@fusorb/intel-sdk` HTTP client
  (analogous to `facet-sdk`) is the right shape for external consumers — the internal packages give
  direct database access and should not be published.
- **Wire the TypeScript parser boundary into the ingestion pipeline** — the parser (`parser.ts`)
   and `linkSymbols` are ready and tested, but not yet called from `ingest.ts` orchestration.
- **Embedding/vector search** — retrieval is currently keyword-based; hybrid lexical + embedding
  search is planned but not yet implemented.
- **Multi-step autonomous tool-calling loop** — `packages/tools` provides the read-only tool surface
  but is not yet wired into an agentic loop.

See the [CLAUDE.md](./CLAUDE.md) for the full agent-facing developer guide.
