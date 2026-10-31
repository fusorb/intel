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

## Outstanding for this repo

- Naming: none outstanding. The remaining `arc*` / `@arcevo` strings are
  deliberate history or examples, not un-migrated code.
- Once the product repos' latest commits are pushed, re-run `pnpm ingest:all`
  and `pnpm verify` so the graph reflects them.
