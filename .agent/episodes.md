# intel: Episodic Canon
## (what broke, how we fixed it, what survived) – local tracker

> Purpose: a living narrative of how this repo reached a working,
> automated state. Written in `.agent/` so the tracker reflects process
> without polluting the published tree.
> Canonical facts live in README/AGENTS.md; this file lives in the
> head between sessions.
>
> Mantra: the graph must tell the truth about the ecosystem.
> Rule chain: manual → semi-automated → automated. If a fact is still
> hand-maintained after a release, it is not done.

================================================================================

EP 01 -- The Sector With No Decisions
--------------------------------------------------------------------------------
What broke:
  Intel could ingest all five entity types (Repository, Package, Module,
  Symbol, Document) but the governance layer was empty. Nothing in the graph
  said "Facet is the only UI system" or "the @arcevo scope is retired", so the
  graph could describe structure but never judge it.

How we fixed it:
  Added a Decision entity with a unique `key`, then authored the six ecosystem
  invariants as committed seed data (`packages/ingest/src/decisions.ts`) and a
  `runGovernance()` step that upserts them, writes GOVERNS edges to every
  Repository/Package/Module they govern, and detects VIOLATES from the live
  graph (retired @arcevo/* deps, shadcn-style UI deps, missing AGENTS.md).

What survived:
  Structure-only ingestion was not enough. The graph needed a layer that
  originates from human standards, not from files on disk.

State: automated. `pnpm seed:governance` re-seeds decisions and recomputes
violations; it is idempotent and clears violations that no longer hold.

Lesson: a knowledge graph without invariants is a map without a legend.

================================================================================

EP 02 -- The Provenance That Wasn't
--------------------------------------------------------------------------------
What broke:
  Early writes recorded entities without full provenance, so a row could not
  be traced back to the file, commit, and evidence level it came from. The
  graph lied by omission: it looked complete but could not be audited.

How we fixed it:
  Made provenance mandatory on every write: sourcePath, sourceCommitSha,
  retrievedAt, and evidenceLevel. Added an EvidenceLevel enum (verified /
  strongly_supported / inferred / unknown) so derived facts (e.g. dependency
  edges) are never mistaken for read-directly facts.

What survived:
  Provenance is not optional metadata; it is the difference between a graph
  and a guess. Nothing gets written without it.

State: automated. Provenance is threaded through every ingest and governance
write.

Lesson: if you can't say where a fact came from, you don't have a fact.

================================================================================

EP 03 -- The Soft-Delete That Fooled Verify
--------------------------------------------------------------------------------
What broke:
  `scripts/verify.ts` dropped from 3/3 to 1/3 after a re-ingest. The real data
  was correct the whole time; the checker was reading soft-deleted rows
  (`removedAt != null`) and comparing against the visible graph.

How we fixed it:
  Added `removedAt: null` to every query in the verify script. The active rows
  had always been right.

What survived:
  Soft-delete is a re-ingest safety net, not a deletion. Every read path must
  filter it explicitly.

State: automated. Verify reads only active rows; the same filter is enforced
across the retrieval layer.

Lesson: when a gate goes red, check whether the gate is wrong before the data.

================================================================================

EP 04 -- The markStale That Ate Its Own Edges
--------------------------------------------------------------------------------
What broke:
  While adding REFERENCES (call-graph) edges, an edit to `markStale()` deleted
  the existing CONSUMES edge cleanup. Re-ingest stopped staling stale
  dependencies, so the graph silently accreted phantom edges.

How we fixed it:
  The acceptance suite caught it. Restored the CONSUMES cleanup and made
  `markStale()` stale REFERENCES edges too, then added a lifecycle test so
  edge counts survive a full run.

What survived:
  One function owned two cleanup responsibilities; the second was added by
  removing the first.

State: automated. `markStale()` stales both CONSUMES and REFERENCES.

Lesson: when you extend a sweep, prove you didn't shorten it.

================================================================================

EP 05 -- The Snapshot That Resurrected the Dead
--------------------------------------------------------------------------------
What broke:
  The ingestion-lifecycle `snapshot/restore` helper blanket-reactivated every
  package for a repo. A test run brought back the stale `arc-id` package and
  staled all 2519 sovgrant symbols, poisoning the graph for subsequent tests.

How we fixed it:
  Rewrote the helper to capture only the ids that were active at snapshot
  time and restore exactly those. Soft-deleted rows stay deleted.

What survived:
  Snapshot/restore must be a faithful inverse, not a mass `removedAt = null`.
  The schema change added a unique `key` to Decision (the only entity without
  a natural key) — `prisma db push --accept-data-loss` in dev.

State: automated. The full suite runs green without leaking state between
tests (153 passed / 2 skipped at last count).

Lesson: a restore that is broader than its snapshot is a leak.

================================================================================

EP 06 -- The 5 MB Bundle That Should Have Been 60 KB
--------------------------------------------------------------------------------
What broke:
  `apps/api` bundled to 5 MB because tsup inlined Prisma and `pg` (workspace
  packages export TS source, so the bundler followed them all the way down).

How we fixed it:
  Externalized Prisma/pg in `apps/api/tsup.config.ts` while bundling the
  `@fusorb/intel-*` workspace packages. Output dropped to 60 KB.

What survived:
  Bundle the code you own; externalize the runtime you install.

State: automated. The image workflow builds and pushes the 60 KB bundle.

Lesson: a bundler will happily inline your database if you let it.

================================================================================

EP 07 -- The Tool That Couldn't Parse
--------------------------------------------------------------------------------
What broke:
  The agentic ReAct loop (`packages/agent`) parses JSON actions
  (`{"action":"tool_call",...}`). The mock provider answers in prose, so it
  never emits a tool call and the loop reports "I don't know" with zero steps.

How we fixed it:
  Kept the mock as the deterministic test double (unit tests assert the loop
  with scripted provider output) and documented that real multi-step runs need
  a capable provider (Anthropic / OpenAI-compatible / Ollama).

What survived:
  The loop works; the mock is a formatter, not a reasoner. Don't judge a
  tool-calling loop by what a mock provider can do.

State: automated for tests; real use requires a function-calling provider.

Lesson: test the harness with scripts, validate the model with a model.

================================================================================

EP 08 -- Postgres on 5433 Would Not Stay Up
--------------------------------------------------------------------------------
What broke:
  The local Postgres kept dying with `P1001 Can't reach database server`. Root
  cause was a stale `postmaster.pid` from a prior crash plus a 60s tool timeout
  killing `pg_ctl` mid-recovery, and detached `start` never taking hold.

How we fixed it:
  Remove the stale pid, run `pg_ctl` detached against a fresh log file (avoids
  the `pg.log` lock), and wait through crash recovery (`57P03 starting up`
  is expected meanwhile, not an error).

What survived:
  Nothing was wrong with the code. The DB-backed tests self-skip without a
  database; the sync workflow proves them nightly on a clean Postgres 18.

State: operational. Dev DB on 5433; CI/sync use ephemeral Postgres.

Lesson: a red gate is sometimes just a process that wasn't allowed to finish.

================================================================================

EP 09 -- SYNC.md Retired For a Vendored Snapshot
--------------------------------------------------------------------------------
What broke:
  `SYNC.md` was hand-written prose tracking which arch-repo commit we were
  aligned to. It drifted the moment anyone forgot to edit it, and it could not
  be verified.

How we fixed it:
  ADR 0008 retires SYNC.md in favour of a vendored snapshot: `vendor/fusorb/`
  plus `PROVENANCE.json` (source commit + per-file SHA-256), produced by
  `tools/consumer/sync-fusorb.mjs`. `pnpm check:fusorb` verifies every file's
  hash offline.

What survived:
  The tracker became machine-checkable. The catch, at the time: the shared tool
  offered only `names|full`, so ADRs (`decisions/*.md`) and standards
  (`content/standards/*`) couldn't be vendored — a real gap logged upstream.
  (Resolved later — see EP 10's `intel` profile.)

State: automated. Snapshot synced against fusorb `634cef02`; check passes.

Lesson: a fact you can't verify is a fact you can't trust.

================================================================================

EP 10 -- The Profiles That Grew, and the Deploy That Would Not Start
--------------------------------------------------------------------------------
What broke:
  Two things. (1) EP09's gap: the shared sync tool offered only `names|full`,
  so ADRs (`decisions/*.md`) and standards (`content/standards/*`) could not be
  vendored — Intel's decisions had no verifiable source. (2) The deploy path
  was latently broken: `docker-compose.yml` mounted the Postgres data volume at
  `/var/lib/postgresql/data`, which postgres:18 moved, so `db` refuses to start;
  a missing `POSTGRES_PASSWORD` produced a database with an empty password; and
  the container never forwarded `INTEL_API_TOKEN`.

How we fixed it:
  (1) Added an `intel` profile to `tools/consumer/profiles.json` that vendors
  ecosystem.json + the ledger + every ADR + every standard, and pointed
  `sync:fusorb` at `--profile intel`. ADRs are now first-class vendored inputs,
  parsed by `adr.ts` into Decision seeds. (2) Hardened the deploy: mounted the
  volume at `/var/lib/postgresql`, made `POSTGRES_PASSWORD` and
  `CLOUDFLARE_TUNNEL_TOKEN` required (`:?`), forwarded `INTEL_API_TOKEN`, wired
  `INTEL_API_TIMEOUT_MS` into a Hono timeout middleware (uniform 504), clamped
  `/search?limit`, added `check:fusorb` to CI as a regression gate, and pruned
  build-only artifacts from the runtime image.

What survived:
  A profile is a contract: extend the list, and the snapshot verifies itself.
  On the deploy side, mount paths and required secrets are correctness, not
  cosmetics — a Postgres that starts on your laptop can still fail in the image.

State: automated. `pnpm check:fusorb` gates CI; the API enforces its request
budget and query limits; the compose stack fails fast when a required secret is
absent.

Lesson: the environment is part of the system. A graph that can't be deployed
can't tell anyone the truth.

================================================================================
