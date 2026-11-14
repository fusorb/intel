# Consumer sync tool

`sync-fusorb.mjs` keeps this repo's `vendor/fusorb/` snapshot of fusorb facts in
step with the `poetic-dev/fusorb` architecture repo. It is dependency-free,
Windows-safe, and configures itself only from `profiles.json`. See ADR 0008 for
the decision behind it.

## Modes

| Command | What it does |
| --- | --- |
| `pnpm sync:fusorb --from <fusorb>` | Copy the profiled files into `vendor/fusorb/` and (re)write `PROVENANCE.json` with the source commit, sync time, and a SHA-256 per file. |
| `node tools/consumer/sync-fusorb.mjs --from-env FUSORB_DIR` | Same, taking the path from an environment variable. Fails loudly when the variable is unset. |
| `pnpm check:fusorb` | Offline: verify the vendored bytes against `PROVENANCE.json` and that the manifest and the vendored tree agree. CI-safe, needs no sibling repo. |
| `pnpm check:freshness` | Freshness: the offline checks, plus the snapshot must match the live source repo. Needs `FUSORB_DIR` pointing at a fusorb clone. |

## Freshness

`--check` alone only proves **self-consistency** (`vendor/` vs `PROVENANCE.json`);
it cannot see a change in the live fusorb repo — a new ADR or standard would go
unnoticed. Given the sibling repo, `--check --from <fusorb>` is a **freshness**
check and additionally fails when:

- `PROVENANCE.sourceCommit` differs from the source repo's HEAD (commit drift),
- a profiled source file is not vendored (for example a new decision), or
- a vendored file has no source in the selected profile.

Freshness needs the fusorb repo present, so it runs locally, or in a scheduled
job where that repo is available. The offline `--check` is the CI-safe one.

Freshness is **not** wired into CI: `poetic-dev/fusorb` is a separate repository,
so whether a runner can clone it is a deployment decision, not a property of this
tool. Run it locally before a sync, and after any upstream change.

## Profiles

Select what is vendored with `--profile`. Profiles compose, so
`--profile names,intel` vendors both sets.

| Profile | Contents |
| --- | --- |
| `names` | The naming ledger, the names gate, and its two libs (`fs-walk`, `glob`). Minimal, for repos that only need naming enforcement. |
| `full` | Ecosystem data (`ecosystem.json`, `naming-ledger.json`) plus the names gate and all shared libs. |
| `intel` | What this repo vendors: ecosystem facts, the ledger, all ADRs, all standards, plus the names gate and its libs. |

An entry in a profile is a file mapping `{ src, dst }` or a directory mapping
`{ srcDir, dstDir }`. A directory expands to every file under it with relative
paths preserved, so a new file — including a new ADR — is vendored without
editing the profile.

## Wiring

Scripts in `package.json`:

```json
{
  "scripts": {
    "sync:fusorb": "node tools/consumer/sync-fusorb.mjs --profile intel",
    "check:fusorb": "node tools/consumer/sync-fusorb.mjs --check --profile intel",
    "check:freshness": "node tools/consumer/sync-fusorb.mjs --check --profile intel --from-env FUSORB_DIR"
  }
}
```

`--from-env <VAR>` is this repo's addition to the shared tool: it lets the
freshness gate be committed without embedding a machine-local path, and it fails
loudly (rather than silently degrading to the offline check) when the variable is
unset. `PROVENANCE.json` holds no org names or local paths, so it stays portable
between machines and repos.
