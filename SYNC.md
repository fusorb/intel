# Fusorb sync — Intel

Source of truth for the ecosystem: the Fusorb architecture repo
(`poetic-dev/fusorb`).

- Naming: `ecosystem/naming-ledger.json`
- Standards: `content/standards/`

Last checked: 2026-10-31, against fusorb `424e31c`.

## Refreshed 2026-10-31

- `README.md`: dropped the stale claims that SovGrant imports `@arcevo/facet-*`
  and that Relnex uses shadcn/ui; refreshed the ecosystem table and the
  question examples to the current state.
- `scripts/verify.ts`: acceptance facts 1 and 3 now assert the current truth
  (SovGrant -> `@fusorb/facet-*`; Relnex -> `@fusorb/facet-components`).
- `packages/retrieval/test/retrieval.test.ts`: keyword example updated to
  `@fusorb/facet-sdk`.
- `.gitignore`: `/scratchpad/`, `/test-output.txt`, and
  `vitest.config.ts.timestamp-*` are now ignored.

## Graph refreshed 2026-10-31

Re-ingested all four product repos onto their latest commits and re-verified.

| Repo | Commit | Packages | Modules | Symbols | Documents |
|---|---|---|---|---|---|
| facet | `30a29238` | 18 | 46 | 3866 | 36 |
| sovgrant | `94de8d2f` | 2 | 125 | 2135 | 10 |
| relnex | `c053e856` | 2 | 75 | 1117 | 5 |
| sovport | `36d99ff2` | 1 | 9 | 209 | 8 |

`pnpm -r typecheck`, `pnpm -r build`, and `pnpm test:run` (109 passed, 2
ollama-integration skipped) all pass; `pnpm verify` reports 3/3.

- `scripts/verify.ts`: the acceptance query now filters `removedAt: null`, so
  soft-deleted legacy rows (`arc-id`, `arcbase`, from the pre-migration commits)
  no longer leak retired `@arcevo/*` / shadcn deps into the facts. This mirrors
  the `removedAt: null` filtering already used throughout `packages/retrieval`.
- Governance is now populated: `Decision` gained a unique `key` and
  `pnpm seed:governance` writes the six ecosystem invariants
  (`packages/ingest/src/decisions.ts`) with their `GOVERNS` edges, then detects
  `VIOLATES` edges (retired `@arcevo/*` scope, shadcn-style UI deps, missing
  `AGENTS.md`/`CLAUDE.md`). Idempotent; re-run after `pnpm ingest:all`.

## Graph refreshed 2026-11-01

Re-ingested all four product repos onto their latest commits (all four had moved
since the 2026-10-31 refresh) and re-verified.

| Repo | Commit | Packages | Modules | Symbols | Documents |
|---|---|---|---|---|---|
| facet | `9f3672f1` | 18 | 48 | 3817 | 40 |
| sovgrant | `91c36ab7` | 2 | 125 | 2141 | 12 |
| relnex | `fefa6f51` | 2 | 75 | 1114 | 6 |
| sovport | `9f4f7e18` | 1 | 10 | 214 | 8 |

`pnpm -r typecheck`, `pnpm -r build`, and `pnpm test:run` (139 passed, 2
ollama-integration skipped) all pass; `pnpm verify` reports 3/3. The active graph
holds 1157 `REFERENCES` edges.

- **Call graph**: ingestion now extracts `REFERENCES` edges between symbols
  (direct + method calls, attributed to the enclosing declaration).
  `find_symbol` / `find_callers` / `find_references` read these edges, and the
  `pnpm ask --agent` loop traverses them.
- **Test hygiene**: the ingestion-lifecycle snapshot/restore helper now covers
  `REFERENCES` edges and restores only the ids that were active at snapshot time,
  so running the suite no longer strands call-graph edges or resurrects stale rows.

## Outstanding for this repo

- Naming: none outstanding. The remaining `arc*` / `@arcevo` strings are
  deliberate history or examples, not un-migrated code.

