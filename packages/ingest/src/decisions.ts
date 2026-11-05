/**
 * The authored Decisions seeded into the graph by `runGovernance()`.
 *
 * These are NOT ingested from repo files — they are the ecosystem's architectural
 * invariants, transcribed from the Fusorb architecture repo
 * (`poetic-dev/fusorb@634cef02`): `ecosystem/ecosystem.json`, the naming ledger,
 * the ADRs in `decisions/*.md`, and `content/standards/*`. This file is the
 * committed source of truth; edit it and re-run `pnpm seed:governance` to
 * converge the graph.
 */

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
  status: "active" | "superseded" | "deferred"
  /** Path within the architecture repo the statement was read from. */
  sourcePath: string
  /** The architecture-repo commit the statement was read at. */
  sourceCommitSha: string
  governs: DecisionTarget[]
}

const ARCH_REPO_COMMIT = "634cef02"

const repo = (repository: string): DecisionTarget => ({ type: "REPOSITORY", repository })

export const ECOSYSTEM_DECISIONS: DecisionSeed[] = [
  {
    key: "ui-invariant-facet",
    title: "Facet is the single mandatory UI system",
    statement:
      "Facet is the single mandatory UI system: no Fusorb repo builds an independent UI, and any future web surface consumes @fusorb/facet-*. A product that cannot use Facet must hold an explicit waiver naming the product, the reason Facet cannot be used today, the migration plan, and the owner who holds it; a waiver is a deviation, not a resolution, and closes when the product migrates. The Facet web packages (@fusorb/facet-components/-auth/-layout) are DOM/Radix/Tailwind and do not run in React Native, so native surfaces such as SovPort consume only @fusorb/facet-sdk (and facet-store).",
    status: "active",
    sourcePath: "content/standards/ui-invariant.md",
    sourceCommitSha: ARCH_REPO_COMMIT,
    governs: [repo("sovgrant"), repo("relnex")],
  },
  {
    key: "naming-ledger",
    title: "Canonical names come from the ecosystem naming ledger",
    statement:
      "Names are not left to drift: ecosystem/naming-ledger.json is the single source of truth and the gate `pnpm check:names` enforces it. Legacy names are history-only — ArcUI→Facet, ArcID→SovGrant, ArcBase→Relnex, ArcWallet→SovPort, @arcevo/→@fusorb/, ArcIdClient→SgClient, ArcProvider→SgProvider, arcid_* storage keys→sg_*. The live public brand and domain (ArcevoCirqle, arcevocirqle.com.ng, and email addresses on that domain) must never be renamed.",
    status: "active",
    sourcePath: "content/standards/naming.md",
    sourceCommitSha: ARCH_REPO_COMMIT,
    governs: [repo("facet"), repo("sovgrant"), repo("relnex"), repo("sovport")],
  },
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
    key: "identity-authority",
    title: "SovGrant is the canonical identity and access layer",
    statement:
      "SovGrant is the single Identity Provider (IdP) for the ecosystem. Every consumer — first-party and third-party relying parties — delegates authentication to SovGrant and never owns credentials; the integration contract is OIDC, and new relying parties integrate as OIDC clients using authorization code with PKCE. SovGrant owns identity, credentials (password/WebAuthn/passkeys/MFA), sessions and tokens, federation, consent, lifecycle, and org/tenant membership, roles, and scopes. Relying parties key local data by a reference to the canonical identity (identityId), must not mirror identity attributes as authority, and verify tokens locally via JWKS (shared-secret verification is a temporary, first-party-only shortcut to retire). The canonical identity reference is the SovGrant Identity.id; the JWT sub claim is that Identity.id.",
    status: "active",
    sourcePath: "decisions/0007-identity-authority.md",
    sourceCommitSha: ARCH_REPO_COMMIT,
    governs: [repo("sovgrant"), repo("relnex"), repo("sovport")],
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
