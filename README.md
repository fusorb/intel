# Fusorb Intel

The knowledge graph for the Fusorb ecosystem.

Intel ingests every active Fusorb product repository (Facet, SovGrant, Relnex, SovPort, Intel) into a
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

- Repos were renamed from Arc-names (ArcUI -> Facet, ArcID -> SovGrant, ArcBase -> Relnex,
  ArcWallet -> SovPort) at the GitHub/org level, and some internal references still lag - for
  example SovGrant's planning docs and `CLAUDE.md` still name the wallet `ArcWallet`, and a
  config key still reads `arcbaseWebhookUrl`.
- Two migrations that once defined the drift have since landed: SovGrant's frontend and Relnex's
  UI now consume `@fusorb/facet-*` rather than `@arcevo/facet-*` and shadcn. The ecosystem still
  needs a system that can prove which cross-repo claims are current and which have drifted.

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
| **Symbol** | A named declaration in source (extracted from `.ts`/`.tsx` via the TypeScript compiler API) | `useAuth`, `handleApiRoute` |
| **Document** | A Markdown/MDX file | `README.md`, `docs/architecture.md` |
| **Decision** | A recorded rule, invariant, or architectural decision (derived from the architecture repo's vendored ADRs plus a small standard-backed seed; not ingested; seeded via `pnpm seed:governance`) | "Facet is the single mandatory UI system across the ecosystem" |

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

Five of these are **emitted today** — `CONTAINS`, `CONSUMES`, `REFERENCES`, `GOVERNS`,
`VIOLATES`. The remaining five (`DEPENDS_ON`, `RENAMED_FROM`, `DOCUMENTS`, `EXPORTS`,
`DEFINES`) are declared in the schema vocabulary but no extractor writes them yet, so the
graph never claims an edge it does not have.

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

This means two documents that disagree (e.g., SovGrant's README, its v2 roadmap, and SovPort's
integration plan each cite a different test count from a different date) are **all recorded with
their timestamps**, not collapsed into a single "current" number. The graph answers "as of <date>,
per <document>: <count>" rather than guessing.

### Ingestion pipeline

The ingestion flow (`packages/ingest/src/ingest.ts`):

```
git clone/fetch ──► file-tree walk ──► entity + symbol extraction ──► DB upsert ──► relationship sync
```

1. **Clone or fetch** — `git clone --quiet --no-tags --depth=1` for new repos; `git fetch --prune`
   + `git reset --hard` for re-ingests. The SHA at HEAD is captured as the commit context.
2. **Walk the tree** — skips `.git`, `node_modules`, `dist`, `.next`, `coverage`, etc. Identifies
   directories that contain source files (modules) and directories that contain `package.json`
   (packages).
3. **Extract entities** — reads each `package.json` (name, version, description, dependencies,
   devDependencies), each source directory (module), each Markdown file (document, with title
   and first non-empty line as description), and each `.ts`/`.tsx` file for symbol declarations
   (functions, classes, consts, etc.) via the TypeScript compiler API parser.
4. **Persist with upsert** — for packages, modules, documents, and symbols; each write carries
   provenance tied to the current commit SHA.
5. **Sync relationships** — writes `CONTAINS` edges from the repository to every entity, and
   `CONSUMES` edges from each package to its declared dependencies. External dependencies not found
   in any ingested repo are placed under a synthetic `npm` repository as placeholder entities with
   `inferred` evidence level.

Re-ingests are idempotent: stale entities are soft-deleted (`removedAt` set) before the current set
is refreshed, so the graph always converges to "as of" the latest commit.

### Symbol extraction

In addition to file-structure-level data (package manifests, directory structure, and document
files), Intel extracts **symbol-level** declarations from every `.ts`/`.tsx` file via the optional
TypeScript compiler API parser (`packages/ingest/src/parser.ts`). The parser is wired into the
ingestion pipeline: each source file is parsed and its symbols (functions, classes, consts, etc.)
are upserted with full provenance. If the `typescript` package is not installed, symbol extraction
is skipped gracefully. A file-count and file-size cap (`MAX_SYMBOL_FILES` = 300,
`MAX_SYMBOL_FILE_SIZE` = 200_000 bytes) bounds the cost per ingestion run;
`node_modules` and build output are excluded.

Each ingestion run records how many files were parsed, skipped (size cap), and
errored (parse failures). Parse errors and per-symbol database errors are surfaced
as warnings — they never silently become `0 symbols`.

---

## Project structure

```
fusorb/intel/
├── schemas/
│   └── graph.prisma              # Canonical Prisma schema (committed, source of truth)
├── packages/
│   ├── evidence/                 # EvidenceLevel enum + provenance helpers (zero deps)
│   ├── graph/                    # PrismaClient singleton + re-exports
│   ├── ingest/                   # Git clone, file-tree walk, entity/symbol extraction, CLI, governance
│   │   └── src/
│   │       ├── adr.ts            # Parses vendored ADRs (vendor/fusorb/decisions) into Decision seeds
│   │       ├── cli.ts            # CLI entry: `pnpm ingest <url> [--branch <branch>]`
│   │       ├── decisions.ts      # Decision seeds: ADR-derived + standard-backed (STANDARD_DECISIONS)
│   │       ├── extract.ts        # File-tree walker + entity parser
│   │       ├── governance.ts     # runGovernance(): seed decisions, write GOVERNS/VIOLATES
│   │       ├── graph.ts          # DB upsert layer (provenance on every write)
│   │       ├── git.ts            # git CLI wrappers (cloneOrFetch, currentCommit, ...)
│   │       ├── ingest.ts         # Orchestration: clone → extract → persist → link
│   │       ├── parser.ts         # TS/TSX symbol + call-reference extraction (TypeScript compiler API)
│   │       └── types.ts          # Extracted entity interfaces
│   ├── provider/                 # IntelligenceProvider + mock/anthropic/ollama/openrouter/openai
│   ├── retrieval/                # Keyword search, graph traversal, symbol lookup, context formatting
│   ├── tools/                    # Read-only tool surface + registry (searchRepo, findSymbol, ...)
│   └── agent/                    # Agentic multi-step tool-calling loop (runAgent)
├── apps/
│   └── api/                      # Internal read-only HTTP service (Hono) → intel.fusorb.com
├── tools/consumer/               # Vendored snapshot sync/check (sync-fusorb.mjs + profiles.json + README.md)
├── vendor/fusorb/                # Vendored architecture-repo snapshot (ADRs, standards, PROVENANCE.json)
├── tests/                        # Cross-package acceptance suite + shared setup
├── scripts/
│   ├── postinstall.cjs           # Runs `prisma generate` on install
│   ├── seed-governance.ts        # `pnpm seed:governance`
│   ├── verify.ts                 # Throwaway script: asserts 3 acceptance facts from real data
│   └── ask.ts                    # Question-answering CLI: `pnpm ask "<question>"`
├── .github/workflows/            # ci · sync · image · anthropic-wif-test
├── Dockerfile · docker-compose.yml
├── tsconfig.base.json · tsconfig.json · pnpm-workspace.yaml
└── .agent/                       # Gitignored scratch (repo clones, outputs, logs)
```

### Packages at a glance

| Package | Role |
|---|---|
| `@fusorb/intel-evidence` | The `EvidenceLevel` enum and provenance type/helpers. Zero runtime dependencies. Imported by `graph` and re-exported, so any consumer can `import { EvidenceLevel } from "@fusorb/intel-graph"`. |
| `@fusorb/intel-graph` | PrismaClient singleton (with `pg` Pool via `@prisma/adapter-pg`, matching the SovGrant pattern) plus re-exports of evidence vocabulary. |
| `@fusorb/intel-ingest` | The ingestion library and CLI. Depends on `graph` and `evidence`. The TypeScript parser (`parser.ts`) is opt-in — `typescript` is an optional dependency, gracefully handled when absent. |
| `@fusorb/intel-provider` | `IntelligenceProvider` interface + five implementations (`mock`, `anthropic`, `ollama`, `openrouter`, `openai`), with citation extraction and unsourced-claim checks. |
| `@fusorb/intel-retrieval` | Keyword search across all entity types, graph traversal (CONSUMES/dependents/CONTAINS), document reading, symbol lookup, and `formatContext` for assembling prompt context. |
| `@fusorb/intel-tools` | Read-only tool surface wrapping retrieval: `search_repo`, `read_document`, `inspect_dependencies`, `find_symbol`, `find_callers`, `find_references`. |
| `@fusorb/intel-agent` | Multi-step tool-calling loop (`runAgent`) driving a provider + the tool registry; used via `pnpm ask --agent`. |

---

## Setup

### Prerequisites

- **Node.js** >= 22
- **pnpm** 12.18.0
- **PostgreSQL** 18

### Installation

```bash
pnpm install
```

The `postinstall` script runs `prisma generate` to produce the typed client. It also sets
`PRISMA_SKIP_ENGINE_DOWNLOAD=true` in-process — this project talks to PostgreSQL via the
`@prisma/adapter-pg` driver adapter, so the Prisma query engine binary is never required.
`prisma generate` itself never connects to a database, so when no `DATABASE_URL` is set
(CI, Docker builds) the script supplies a placeholder for that child process only; every
real command still requires the real value and fails loudly without it.

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

### Ingest all five repos

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

This acceptance script (`scripts/verify.ts`) asserts three facts from real data, and gates
the nightly `sync` workflow:

1. SovGrant's manifests reference `@fusorb/facet-*` (not `@arcevo/facet-*`).
2. Facet ships Package entities for `packages/motion`, `packages/native`, and `packages/sandbox`.
3. Relnex depends on `@fusorb/facet-components` (the shadcn stack is retired).

### Seed decisions and governance

Architectural decisions are **not ingested from the product repos**. Most are derived from the
architecture repo's own ADRs, vendored under `vendor/fusorb/decisions/*.md` (9 ADRs, `0001`–`0009`)
and parsed by `packages/ingest/src/adr.ts`: the ADR filename slug is the stable `key`, the H1
(leading `N. ` ordinal stripped) the title, the verbatim `## Decision` section the statement,
and the frontmatter supplies `status`/`governs` (`governs` ids filtered to those present in
`vendor/fusorb/ecosystem.json`) with `sourceCommitSha` from `vendor/fusorb/PROVENANCE.json`. A
small hand-authored remainder in `packages/ingest/src/decisions.ts` (`STANDARD_DECISIONS`) covers
the standards no ADR exists for: the retired `@arcevo` npm scope, the repo-structure baseline,
and the agent protocol. Write them to the graph with:

```bash
pnpm seed:governance
```

This upserts each `Decision` by its stable `key` with provenance, prunes any Decision no longer
in the seed (deleting its relationships first), writes a `GOVERNS` edge to every
Repository/Package/Module it governs, then scans the graph for violations — retired
`@arcevo/*` dependencies, shadcn-style UI deps that bypass Facet, and repos missing
`AGENTS.md`/`CLAUDE.md` — and writes `VIOLATES` edges. Re-running is idempotent and clears
violations that no longer hold, so the graph converges to the current commit.

### Asking questions

Intel answers natural-language questions about the graph end-to-end through retrieval + provider:

```bash
pnpm ask "Which repositories still reference @arcevo/facet-sdk?"
```

`scripts/ask.ts` performs a single retrieval pass over the graph, formats the results with
provenance into a prompt, and sends it to a hosted model via `packages/provider`. Every factual
claim in the answer is cited inline as `[source: <sourcePath>, commit: <sourceCommitSha>]`, and
the provider runs a post-generation check that flags unsourced claims or citations whose
`sourcePath` doesn't appear in the retrieved context. Follow-up questions automatically reuse the
previous retrieval's context (`.agent/ask-context.txt`), so you can ask "When was that fact last
confirmed?" and get a time-aware answer.

### Providers

Intel talks to any OpenAI-compatible chat API. Set `INTEL_PROVIDER` plus the matching
variables (see `.env.example`):

| Provider | Variables | Notes |
|---|---|---|
| `mock` | — | Deterministic, no network. The default; what CI uses. |
| `anthropic` | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `ANTHROPIC_TIMEOUT_MS` | Hosted Claude. |
| `ollama` | `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `OLLAMA_TIMEOUT_MS` | Local; free. |
| `openrouter` | `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `OPENROUTER_BASE_URL`, `OPENROUTER_TIMEOUT_MS` | Aggregator. |
| `openai` | `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_BASE_URL`, `OPENAI_TIMEOUT_MS` | Generic OpenAI-compatible. Point `OPENAI_BASE_URL` at Groq, Cerebras, Mistral, Gemini, GitHub Models, Cloudflare Workers AI, or a local server (LM Studio, llama.cpp, vLLM, Ollama's own `/v1`). `OPENAI_API_KEY` is optional — local servers need none. |

Free options for exercising the full `ask` path: a smaller local Ollama model, or a hosted
OpenAI-compatible free tier (Groq, Cerebras, Gemini, GitHub Models) via `INTEL_PROVIDER=openai`.

### Agent mode

Use multi-step tool use to explore the graph autonomously:

```bash
pnpm ask "Find all callers of function parseTypeScriptFile" --agent
```

The agent can use `search_repo`, `read_document`, `inspect_dependencies`, `find_symbol`, `find_callers`, and `find_references`. `find_callers`/`find_references` use REFERENCES edges when available, with best-effort fallbacks.

### API (`apps/api`)

`apps/api` is a thin, **read-only** HTTP service over the graph — the surface for the internal
tool at `intel.fusorb.com`. It wraps the same packages the CLI uses and never exposes SQL or an
arbitrary tool.

```bash
pnpm --filter @fusorb/intel-api dev      # tsx src/index.ts
pnpm --filter @fusorb/intel-api build    # tsup → apps/api/dist
node apps/api/dist/index.js              # requires INTEL_API_TOKEN in token mode
```

Auth is a single-user bearer token by default (`INTEL_API_AUTH=token` + `INTEL_API_TOKEN`);
`cloudflare-access` trusts the edge identity header instead; `none` is development-only. The
server refuses to start in token mode without a token.

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/health` | Liveness + database probe (unauthenticated) |
| `POST` | `/ask` | Single-shot answer (retrieve → prompt → provider) |
| `POST` | `/ask/agent` | Multi-step agent answer (returns tool names) |
| `GET`  | `/search?q=&repo=` | Keyword search |
| `GET`  | `/symbols?name=&repo=&kind=` | Symbol lookup |
| `GET`  | `/symbols/:id/callers` · `/references` | Call-graph lookups |
| `GET`  | `/decisions` · `/violations` | Governance |

Configuration lives in `.env.example` (`INTEL_API_*`).

### Deployment

- **Container:** `Dockerfile` builds `apps/api` and runs it on Node 22 as a non-root user; `GET /health` is the container healthcheck.
- **Bundle:** `apps/api` bundles the workspace packages into `dist/` (they export TypeScript source, which Node cannot load directly); Prisma and `pg` stay external.
- **Migrations:** dev uses `pnpm prisma:push`; production uses `pnpm prisma:migrate` (`prisma migrate deploy`) against the committed baseline in `schemas/migrations/`.
- **Host:** provide a private/managed Postgres, inject `DATABASE_URL` and `INTEL_API_*` from the platform's secret store, and terminate TLS at the edge. The API binds `0.0.0.0:$PORT` behind the platform proxy.

Full operational steps are in [`docs/deploy.md`](./docs/deploy.md): database, access (Cloudflare Access or token), data-egress policy, and host options.

The chosen stack is **a VPS behind Cloudflare** — `docker-compose.yml` runs `api` + `db` + `cloudflared` (with an optional self-hosted `ollama`), so no inbound ports are open.

---

## Development workflow

1. Make your changes.
2. `pnpm typecheck` — type-check every package plus the cross-package `tests/` project (must pass).
3. `pnpm -r build` — build every package with tsup (must pass).
4. `pnpm test` — run the full test suite (unit + integration + acceptance).
5. If you changed `schemas/graph.prisma`: `pnpm prisma:push` to sync the database
   (or `pnpm prisma:generate` if only types changed).
6. Re-ingest repos after schema or code changes: `pnpm ingest:all`.
7. Re-run verification: `pnpm verify`.

### Continuous integration

GitHub Actions workflows keep the repo honest:

- **`ci`** (`.github/workflows/ci.yml`) — on every push to `main` and every PR:
  install, `pnpm check:fusorb` (vendored-snapshot integrity), `pnpm -r typecheck`,
  `pnpm -r build`, and the unit tests. No database is provisioned, so the DB-backed
  tests self-skip.
- **`sync`** (`.github/workflows/sync.yml`) — nightly and on demand: provisions
  PostgreSQL, `prisma db push`, `pnpm ingest:all`, `pnpm seed:governance`, then
  `pnpm verify` and the full suite. It fails when a product repo drifts, so the
  graph never goes quietly stale.
- **`image`** (`.github/workflows/image.yml`) — on push to `main` (for changes that
  affect the service): builds the `Dockerfile` and pushes
  `ghcr.io/fusorb/intel/intel-api` (latest + commit SHA).

`pnpm check:fusorb` is the **offline** snapshot check — it proves `vendor/fusorb/`
matches `PROVENANCE.json`, and needs nothing but this repo, so CI runs it. It cannot
see a change in `poetic-dev/fusorb` itself. The **freshness** check
(`pnpm check:freshness`, needs `FUSORB_DIR` pointing at a fusorb clone) additionally
fails on commit drift, on a profiled source file that is not vendored (a new ADR), or
on a vendored file with no source. Run it before a sync and after any upstream change;
it is deliberately not wired into CI, because whether a runner can reach the
architecture repo is a deployment decision.

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
- **Idempotent upserts** — `Repository`, `Package`, `Module`, `Document`, `Symbol`, and
  `Relationship` are all upserted by natural key, not appended. Re-ingesting the same commit
  produces no duplicates.

---

## The Fusorb ecosystem in brief

Intel ingests these five product repositories:

| Repo | Role | Current state |
|---|---|---|
| **[facet](https://github.com/fusorb/facet)** | Domain-customizable, auth-first UI component system | Mature - the canonical UI layer for the ecosystem |
| **[sovgrant](https://github.com/fusorb/sovgrant)** | Sovereign, multi-tenant identity/access/credentials engine | Backend implemented; frontend on the published Facet packages |
| **[relnex](https://github.com/fusorb/relnex)** | Knowledge-graph content management | Migrated to the Facet packages; development paused while SovGrant stabilizes |
| **[sovport](https://github.com/fusorb/sovport)** | Self-sovereign identity wallet (credential holder) | Integration in progress against the SovGrant SDK |
| **[intel](https://github.com/fusorb/intel)** | Architectural and engineering intelligence layer (this repo) | Ingested so the graph models every ecosystem product, including Intel itself |

### What Intel ingests from each

- **package.json files** → Package entities with real and dev dependency maps
- **source directories** (anything with `.ts`/`.tsx`/`.js`/`.jsx`) → Module entities
- **Markdown files** (`.md`, `.mdx`, `.markdown`) → Document entities with title + summary
- **TS/TSX files** → Symbol entities (functions, classes, consts, etc.) via the TypeScript compiler API
- **Call/reference usage in TS/TSX** → REFERENCES edges between symbols (a best-effort call graph)
- **Dependency declarations** → CONSUMES relationship edges (with semver range as the `note`)
- **Repository → entity containment** → CONTAINS relationship edges
- **IngestionRun** → per-repo ingestion metadata (commit, status, entity/edge counts)

### What Intel surfaces

Because every fact carries its commit SHA and timestamp, Intel can answer questions like:

- *"Which repositories still reference `@arcevo/facet-sdk`?"*
  -> The npm-scope migration is complete: SovGrant and Relnex resolve `@fusorb/facet-*`. Intel can
  still answer the historical question with the commit where the switch happened, and reports
  `unknown` for any repo it has not ingested.
- *"How many tests does SovGrant have?"*
  -> Intel surfaces **all** numbers with their dates, one per source (the README, the v2 roadmap,
  and SovPort's integration plan). A single-snapshot answer would be wrong; the graph captures
  the full picture.
- *"Does Relnex use Facet for its UI?"*
  -> Relnex's dependencies now include `@fusorb/facet-components`; the earlier shadcn stack has
  been retired. This is a verified satisfaction of the "Facet is the only UI system" decision,
  with the commit that made the switch recorded in the graph.

---

## Still deferred

- **External SDK** — an eventual thin `@fusorb/intel-sdk` HTTP client (analogous to `facet-sdk`)
  is the right shape for external consumers; the internal packages give direct database access and
  should not be published.
- **Embedding / hybrid retrieval** — retrieval is keyword-based today; hybrid lexical + embedding
  search is planned but not implemented.
- **A web UI / architecture explorer** — no frontend ships at this tier; if one is built it follows
  the ecosystem invariant and uses Facet.

Everything else the project set out to do is implemented: ingestion (packages/modules/documents/
symbols), governed decisions, retrieval, the provider layer, the read-only tool surface, the
agentic loop (`pnpm ask --agent`), and the internal HTTP service (`apps/api`).

See the [CLAUDE.md](./CLAUDE.md) for the full agent-facing developer guide.
