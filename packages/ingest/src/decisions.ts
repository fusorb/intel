/**
 * The Decisions seeded into the graph by `runGovernance()`.
 *
 * Two sources:
 *
 *  1. ADR-derived seeds — parsed at load time from the vendored architecture-repo
 *     ADRs under `vendor/fusorb/decisions/*.md` (see `adr.ts`). For every decision
 *     an ADR covers, the ADR's `## Decision` section is the canonical statement, so
 *     it is read from the vendored file rather than transcribed by hand here.
 *  2. Standard-backed hand-authored seeds — the decisions no vendored ADR covers:
 *     `retired-npm-scope` (ecosystem.json), `repo-structure-baseline`
 *     (standards/repo-structure.md), and `agent-protocol`
 *     (standards/agent-protocol.md).
 *
 * The three former hand-authored seeds that ADRs now cover are RETIRED:
 *   - `ui-invariant-facet`  -> ADR `0005-ui-invariant`
 *   - `naming-ledger`       -> ADR `0003-naming-ledger`
 *   - `identity-authority`  -> ADR `0007-identity-authority`
 * Seeding is upsert-by-key and never deletes, so removing a key here does not
 * remove its row: the old rows (and their GOVERNS edges) linger until removed out
 * of band. We deliberately do not hand-delete them.
 *
 * The vendored tree is pinned at `poetic-dev/fusorb@634cef02`
 * (`vendor/fusorb/PROVENANCE.json`). Edit the ADRs upstream and re-sync, or edit
 * the standard-backed seeds below; then run `pnpm seed:governance` to converge.
 */

import { loadAdrDecisions } from "./adr.js"

export interface DecisionTarget {
  type: "REPOSITORY" | "PACKAGE"
  repository: string
  /** Required when `type` is "PACKAGE". */
  packageName?: string
}

export interface DecisionSeed {
  /** Stable slug — the idempotent natural key in the graph. */
  key: string
  title: string
  statement: string
  status: "active" | "proposed" | "superseded" | "deferred"
  /** Path within the architecture repo the statement was read from. */
  sourcePath: string
  /** The architecture-repo commit the statement was read at. */
  sourceCommitSha: string
  governs: DecisionTarget[]
}

/** Short sha of the vendored architecture-repo commit (see vendor/fusorb/PROVENANCE.json). */
const ARCH_REPO_COMMIT = "634cef02"

const repo = (repository: string): DecisionTarget => ({ type: "REPOSITORY", repository })

/** Standard-backed decisions that no vendored ADR covers. */
const STANDARD_DECISIONS: DecisionSeed[] = [
  {
    key: "retired-npm-scope",
    title: "The @arcevo npm scope is retired; packages use @fusorb/*",
    statement:
      "The @arcevo npm scope is retired. Every ecosystem package publishes and consumes under the @fusorb/* scope; @arcevo/facet-* is unpublished (returns 404 on the registry).",
    status: "active",
    sourcePath: "ecosystem/ecosystem.json",
    sourceCommitSha: ARCH_REPO_COMMIT,
    governs: [repo("facet"), repo("sovgrant"), repo("relnex"), repo("sovport")],
  },
  {
    key: "repo-structure-baseline",
    title: "Every Fusorb repo meets the repo-structure baseline",
    statement:
      "Every Fusorb repo should meet a minimum baseline: an agent rules file (AGENTS.md) loaded at the start of every session, a thin CLAUDE.md pointing to it, a CI workflow that installs and runs the repo's checks, a decisions/ folder for ADRs, a README with purpose/setup/structure sections, and a .gitignore (plus a .gitattributes with LF normalization on Windows-authored repos).",
    status: "active",
    sourcePath: "content/standards/repo-structure.md",
    sourceCommitSha: ARCH_REPO_COMMIT,
    governs: [repo("facet"), repo("sovgrant"), repo("relnex"), repo("sovport")],
  },
  {
    key: "agent-protocol",
    title: "Agents write only inside the target repo",
    statement:
      "Agents open sessions inside the repo being changed; sibling and product repos are read-only unless the task is for that repo, and an agent never writes, commits, installs, builds, or runs scripts outside the repo being changed. Consult the naming ledger before any rename and never apply a rename without a ledger entry. Branch per task; never push and never touch main. Use the gitignored .agent/ directory for local scratch. Verify against code, not roadmaps or README claims. Agent-tool files are tracked deliberately: .commandcode/taste/** stays tracked (reviewed, shared preferences) while everything else under .commandcode/ is machine-specific and ignored, via the pattern pair .commandcode/* plus !.commandcode/taste/ and !.commandcode/taste/**.",
    status: "active",
    sourcePath: "content/standards/agent-protocol.md",
    sourceCommitSha: ARCH_REPO_COMMIT,
    governs: [repo("facet"), repo("sovgrant"), repo("relnex"), repo("sovport")],
  },
]

/** ADR-derived seeds first (sorted by ADR filename), then the standard-backed seeds. */
export const ECOSYSTEM_DECISIONS: DecisionSeed[] = [
  ...loadAdrDecisions(),
  ...STANDARD_DECISIONS,
]
