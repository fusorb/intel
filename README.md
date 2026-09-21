# FUSORB INTEL — Architectural Reconnaissance Report

*Findings are marked VERIFIED (fetched directly from the source), INFERRED (a reasoned
conclusion from verified evidence), or UNKNOWN (no evidence found yet). Nothing below is
invented to fill a gap. This draft additionally incorporates direct reads of the four internal
planning documents flagged as open items in earlier passes: `relnex/docs/architecture.md`,
`relnex/docs/arcbase-roadmap.md`, `sovgrant/docs/planning/arcid-v2-roadmap.md`, and
`sovport/docs/arcwallet-integration-planning.md`.*

---

## A. Ecosystem map

```
ArcevoCirqle  (public-facing ecosystem, current)
      │  operates as "a Fusorb initiative"
      ▼
Fusorb  (internal system/architecture layer, emerging)
      │
      ├── Facet     — interface/component system         [VERIFIED — mature]
      ├── SovGrant  — identity, access, credentials       [VERIFIED — mature, v1 complete]
      ├── Relnex    — knowledge/resource/graph system     [VERIFIED — early/mid, rebuild in progress]
      ├── SovPort   — wallet / portable identity          [VERIFIED — blank Expo scaffold, phased plan exists]
      └── Intel     — intelligence layer (this project)   [VERIFIED — empty, 1 commit]

Discovered but not yet a repo: "ArcVerify" — a verifier-facing counterpart to SovGrant, listed
in SovGrant's own v2+ roadmap as a 1.0.0 milestone item. Treat as PLANNED/named-but-unbuilt, not
as a sixth product repo.

Long-term (2-3yr horizon, not guaranteed): ArcevoCirqle evolves into FusorbHQ, the future
public-facing headquarters state. FusorbHQ does not exist today.
```

`poetic-dev` is the GitHub account actually committing into the `fusorb` org's repos (confirmed
via `fusorb/relnex` PR #1, merged by `poetic-dev`) — i.e. it's the developer identity, not a
separate product line. It also owns two ArcevoCirqle-related scaffolds directly (`arcevocirqle`
and the older `arcevo-cirqle`) and the `fusorb` HQ repo — all confirmed public, all confirmed
to exist, with two distinct and now-confirmed audiences: `arcevocirqle` is the live, public-
facing layer; `poetic-dev/fusorb` is the architectural/product layer for developers,
organizations, and integrators of Fusorb products — not the general public.

`CommandCode` (a `.commandcode` folder plus `CommandCodeBot` co-authored commits, and an `.agent`
folder alongside it) is the coding agent used consistently across `facet`, `relnex`, `sovgrant`,
and `sovport` — this is an existing, load-bearing convention across every active product repo,
and Intel should be aware of it rather than compete with it.

**The stated mission** (directly from the architect, worth recording as a first-class fact
because it's the actual reason this whole exercise matters): the ecosystem's aim is to break
fragmentation — build tools and products that solve fragmentation problems (SovGrant unifying
identity, Relnex unifying knowledge, Facet unifying UI) — while *simultaneously* building the
tools **and the people/practices** that keep that solution consistent over time. Intel's
evidence/graph model is the infrastructure form of that second half, not a side project relative
to it.

---

## B. Historical lineage

| Old name | Current repo | Status of the rename in the repo itself |
|---|---|---|
| ArcUI | `fusorb/facet` | **Fully renamed** — README, package scope (`@fusorb/facet-*`), and code all say Facet |
| ArcID | `fusorb/sovgrant` | **Renamed at the repo/org level only** — GitHub redirects `arcevodev/arc-id` → `fusorb/sovgrant`, but the README's `H1`, the internal `CLAUDE.md`, and the v2 roadmap doc itself all still say "ArcID" throughout, consistently, as of a 2026-09-01 update |
| ArcBase | `fusorb/relnex` | **Renamed at the repo level only** — the README's `H1` is still literally `# Arcbase`, and its own architecture/roadmap docs call the ecosystem "Arcevo" and the identity service "Arc-ID" throughout |
| ArcWallet | `fusorb/sovport` | **Renamed at the repo level only** — the README's `H1` is still literally `# ArcWallet`, its own integration-planning doc calls itself "ArcWallet x ArcID Integration Plan," and its "Related" links still point to `arcevodev/arc-id` and `arcevodev/facet` |

This is the single most important factual finding for Intel's design, and reading all four
internal planning documents strengthens rather than weakens it: **the rename from Arc- names to
the current names is a repo/org-level event that has not propagated into any internal
documentation anywhere in the ecosystem** — not READMEs, not architecture docs, not roadmaps, not
cross-repo doc links, and in SovGrant's/SovPort's case, not the actual package scope either. Every
internal planning document read in this pass uses the old names exclusively and unselfconsciously
— this isn't a stale README someone forgot to update, it's the working vocabulary of the
engineering docs themselves. A tool that trusted any single document's self-description as ground
truth would misidentify every migrated repo by name. This is exactly the kind of drift Intel
exists to catch, and it is total, not partial.

There is a known, deliberate, and roadmapped reason behind the npm-scope half of this drift (see
section C, SovGrant) — not all of this lineage gap is accidental or unaddressed. The
naming-in-prose lag (README titles, internal doc titles, cross-repo doc links) has no stated
remediation plan in any of the four documents read in this pass.

---

## C. Repository inventory

### `fusorb/facet` — VERIFIED, mature, freshly re-fetched at 192 commits (up substantially from earlier passes)
- **Purpose**: domain-customizable, auth-first component system — intended, per the architect, to
  be the **single, mandatory UI system across the entire ecosystem**: no other repo, on any
  framework (web or native), is meant to build or consume independent UI. This is why Facet's
  scope is being extended aggressively rather than treated as "just" a component library. The
  README's own framing, current as of this re-fetch: *"facet is what you get when you own the
  identity backend (SovGrant), have a formal design manual (Alpha Palette), and your auth
  requirements differ per sector (fintech vs med vs edu vs enterprise)."* **"Alpha Palette" is a
  newly-surfaced name** — the ecosystem's formal design manual, referenced directly in
  `facet-tokens`'s own description.
- **Stack**: TypeScript strict/ESM, React 19, Tailwind v4, pnpm + Turborepo + Changesets.
- **Architecture**: 4 layers (Primitive → Styled Base → Composed → Domain Preset), 3
  customization axes (appearance/config/slots), 5 domain presets (fintech/med/edu/enterprise/
  default) via a `registerPreset`/`getPreset`/`resolvePreset` registry.
- **Packages — corrected this pass**: the README's own package table (re-fetched above) is
  **stale relative to the actual `packages/` directory**, which was verified directly this pass
  and contains twelve folders, not nine: `auth`, `cli`, `components`, `docs`, `emails`, `layout`,
  **`motion`**, **`native`**, `sandbox`, `sdk`, `store`, `tokens`. The README's own "Quick Start"
  line — *"`pnpm typecheck` # all 11 projects"* — is itself a stale artifact of the repo's earlier
  9-packages-plus-2-apps state; it predates `motion`, `native`, and `sandbox` being added, and
  wasn't updated when they landed. **This is a fresh, self-contained example of the exact same
  doc-lag pattern found ecosystem-wide (README/docs trailing actual code) — this time inside
  Facet's own repo, against Facet's own most recent commits, not an older cross-repo rename.**

  The nine README-documented packages, with real published versions (unchanged from the
  previous pass):

  | Package | Description | Version |
  |---|---|---|
  | `@fusorb/facet-tokens` | Design tokens: Alpha Palette, typography, spacing, CSS vars | 1.1.4 |
  | `@fusorb/facet-sdk` | **SovGrant** API client (pure fetch, typed, **10 domain SDKs**) | 1.2.0 |
  | `@fusorb/facet-components` | 114 styled UI components (Radix + tailwind-merge + variants) | 1.11.0 |
  | `@fusorb/facet-auth` | Auth components + domain presets: SignIn, SignUp, Guard, MfaDialog, forms | 1.2.3 |
  | `@fusorb/facet-layout` | Domain-configurable app shell: ConsoleLayout, AuthLayout, LandingLayout, Sidebar, Topbar, 5 presets | 1.4.2 |
  | `@fusorb/facet-store` | Framework-agnostic Zustand stores (auth + tenant) + token-refresh bridge, web + React Native | 2.0.0 |
  | `@fusorb/facet-docs` | Installable docs engine: mount `<DocsApp>` with your own brand, nav, pages | 1.4.7 |
  | `@fusorb/facet-cli` | Scaffold docs, audit/update, copy components, generate a tree-shaken icon registry | 2.0.0 |
  | `@fusorb/facet-emails` | Framework-agnostic email builder + React bridge | 1.1.1 |

  **Three additional packages, present in the repo and verified directly via each package's own
  `package.json` (not yet listed in the README table — not yet published to npm, version `0.1.0`
  on all three, consistent with "recently added, unreleased"):**

  | Package | Description (verbatim from `package.json`) | Version | Notes |
  |---|---|---|---|
  | `@fusorb/facet-motion` | "Domain-customizable animation engine: generator-driven core (tween + spring), observable motion values, CSS driver with prefers-reduced-motion, a 15-family generative registry, and thin React bindings. Wired to `@fusorb/facet-tokens` CSS custom properties." | 0.1.0 | Has a `check:motion-drift` script and a `@fusorb/facet-tokens` dependency — this is, concretely and specifically, the Phase 1 scope from this session's own earlier facet-motion architecture work, now built. The 15-family registry, the tween/spring-only generator scope, the CSS-only driver, and the drift-gate script all match that plan's spec directly. |
  | `@fusorb/facet-native` | "React Native motion driver for `@fusorb/facet-motion` — subscribes facet motion values to a consumer-provided Animated module (react-native or reanimated v2) via `bindAnimated()`." | 0.1.0 | **This resolves an open item directly**: SovPort's own integration-planning doc speculated a future native UI package would be named `@arcevo/facet-rn`; the actual, already-scaffolded package is named `@fusorb/facet-native`. The two names were never the same artifact under two labels — the real one has landed under the newer name, ahead of SovPort's own doc predicting it. |
  | `@fusorb/facet-sandbox` | "Framework-agnostic live-preview sandbox host: block registry, adapter seam, security helpers. Ships no framework code; the React adapter ships under `/react`." | 0.1.0 | A previously undiscovered capability — a live-preview/playground engine, framework-agnostic core with a separate React adapter. Plausibly the underlying engine beneath `facet-docs`'s `<InteractiveDemo>` component (not confirmed this pass — worth checking directly rather than assuming the connection). |

  **A specific and important correction to earlier passes**: `@fusorb/facet-sdk`'s own current
  description literally reads *"SovGrant API client"* — meaning Facet's own docs have **already
  adopted the current name**, in contrast to SovGrant's own repo, which still calls itself "ArcID"
  internally throughout. The naming lag identified in sections B/C is not uniform in direction —
  the consuming package (Facet) is ahead of the product it names (SovGrant) on this specific
  point. Also confirms the SDK's "10 domain SDKs" line matches exactly the ten classes SovPort's
  own integration plan lists (`AuthSdk`, `PasskeySdk`, `VcSdk`, `IdentitySdk`, `OAuthSdk`,
  `TenantSdk`, `BillingSdk`, `WebhooksSdk`, `AuditSdk`, `IdpSdk`) — cross-repo consistency, now
  directly verified rather than assumed.
- **New layout detail surfaced this pass**: `ConsoleLayout` has two sidebar modes —
  `mode="full"` (always-labeled) and `mode="rail"` (collapsible to icon-only, persisted in
  `localStorage`), both mobile-responsive via a Sheet. `AuthLayout` was **renamed from
  `AppLayout`**, with the old name kept as a deprecated alias — a clean internal example of
  managed renames-with-compatibility, worth contrasting with the ecosystem-wide Arc-name lag,
  which has no such alias/deprecation mechanism anywhere. `LandingLayout` is a glassmorphic,
  glow-CTA marketing shell meant to pair with a `Navbar` `pill` variant.
- **CI**: real drift gates (`check:docs`, `check:icons`, `check:sdk-drift`, `check:components`)
  fail the build if a package's surface and its documented surface disagree. Publishing is a
  three-job pipeline (`ci` → `changeset` → `publish`) that only ships from a clean, rebuilt tree
  after the version-bump PR merges — never a stale or dirty build.
- **AI-agent instructions**: `CLAUDE.md` (full handbook) + `AGENTS.md` (condensed always-loaded
  rules) — same pattern as every other repo in the org.
- **Maturity, re-verified this pass**: **192 commits** — a substantial jump reflecting genuinely
  active, ongoing development, consistent with the architect's statement that Facet is the team's
  current full-time build priority. The README's "all 11 projects" line is stale (see above) —
  the live repo now has 12 packages plus 2 apps (landing + docs-demo, confirmed under `apps/`),
  i.e. 14 projects, not 11.
- **npm namespace status**: per the architect, the `@fusorb` npm organization name is currently
  blocked/unavailable at the npm-org level (a separate matter from the `@fusorb/facet-*` package
  scope, which is already live and versioned). Facet is the team's full-time build priority right
  now; SovGrant, SovPort, and Relnex are explicitly slated to migrate their Facet consumption from
  the old `@arcevo/facet-*` scope onto `@fusorb/facet-*` once the org-level namespace issue
  clears. **Stated build sequencing after that**: SovGrant to full maturity first (it's the
  primary canonical identity layer feeding every other system), then Relnex, which is specifically
  planned to curb *knowledge* fragmentation the way SovGrant curbs *identity* fragmentation.

### `fusorb/sovgrant` (README, `CLAUDE.md`, and roadmap doc all still say "ArcID") — VERIFIED, mature, v1 complete
- **Purpose**: sovereign, multi-tenant identity/access-management engine — the identity backbone
  the rest of the ecosystem is meant to build on.
- **Stack**: Fastify + PostgreSQL/Prisma backend, Next.js 16 admin dashboard, Docker
  (`node:22-alpine`), Postgres 17 + Redis 7 via `docker-compose`.
- **v1 (0.1.0) is stated as COMPLETE** in its own roadmap doc (`docs/planning/arcid-v2-roadmap.md`,
  last updated 2026-09-01): all of Phase 0–8 plus Phase E shipped. Full inventory as stated
  there: password/passkey/magic-link/TOTP MFA/social auth; full OAuth2/OIDC provider (PKCE,
  refresh rotation, introspection, revocation, JWKS, discovery, userinfo); SD-JWT VCs (issue,
  verify, presentation/exchange); `did:web`+`did:key` with per-tenant KMS-encrypted signing keys;
  multi-tenant RBAC (19 seeded permissions, 16 permission-gated routes); **SAML2 + OIDC
  federation** via a dedicated `idp` module (outbound SP-initiated); HMAC-signed webhooks with
  retry; Redis-backed distributed session revocation; 6 enforced tenant-policy fields; audit
  logging (51 `AuditLogAction` enum values, 100% call-site coverage); rate limiting; CORS;
  SSRF/CSRF protection; 6 cross-tenant isolation tests; Pino observability with correlation IDs
  and a `/metrics` endpoint; a completed "Facet migration" (Phases 0–6 + E, done 2026-08-19) for
  the frontend rebuild.
- **SDK and CLI, per the same roadmap**: a published `@arcevo/facet-sdk@1.1.0` — class-based
  `AuthSdk`/`TenantSdk`/`OAuthSdk`/`CredentialSdk`/`WebhookSdk`/etc., where SovGrant's own
  `src/sdk/index.ts` is a thin singleton wrapping an `ArcIdClient` (401 auto-refresh wired to its
  Zustand auth store) around the re-exported Facet SDK classes. A `packages/cli` is scaffolded on
  `@arcevo/facet-cli@0.8.0`, with a v2 item (P1, currently paused pending API contract stability)
  to extract it into its own published package — planned name, per the roadmap itself, is
  `@arcevo/arcid-cli`, i.e. even SovGrant's own forward-looking package-naming plan still uses the
  old "arcid" name, not "sovgrant."
- **v2 (0.2.0), stated as ACTIVE**: ArcWallet/SovPort end-to-end integration is **P0, not
  started**; API-key management backend is **done** (`ApiKey` model, CRUD flows, SHA-256 hashed
  tokens, bearer-token auth guard, 16 unit tests); integration tests against real Postgres are
  unblocked; a billing UI (pricing from `plan-caps.ts`, rendered via `facet-components`) is
  **in progress in the working tree right now**.
- **v2+/future, per the same roadmap**: a **new, previously undiscovered planned product/module,
  "ArcVerify"** — a verifier-facing counterpart to SovGrant handling presentation verification —
  listed as a 1.0.0-milestone item, P0, alongside open-source release and credential revocation
  via status lists (RFC 9397). A substantial "deferred/exploratory" backlog also exists (BBS+
  anonymous credentials, `did:jwk`, OIDC4VCI issuance, OPA/Cedar policy engines, SAML IdP-initiated
  flow, SCIM provisioning, passkey attestation, WebAuthn conditional mediation, credential
  manifests, ZKP for SD-JWT, DIDComm messaging, FIDO2 enterprise attestation, bitstring credential
  status) — explicitly not near-term, but worth Intel indexing as "considered, not planned."
- **A concrete, useful example of why Intel needs temporal/versioned evidence, not single-snapshot
  facts**: three different documents in this session report three different test counts for the
  same backend, at three different dates — the README says 61 test files / 342 tests; the v2
  roadmap (updated 2026-09-01) says 62 test files / 358 tests; SovPort's own integration-planning
  doc, cross-referencing SovGrant's `.agent/output.txt` as of 2026-08-05, says 59 test files / 326
  tests. None of these are wrong — they're snapshots at different commits. A system that treated
  any one of them as *the* current fact, without a timestamp attached, would eventually be
  confidently incorrect. This is precisely the provenance/temporal-validity problem the brief
  itself raises in section 14, now with a concrete example already sitting in the ecosystem's own
  docs.
- **Frontend dependency note**: consumes `@arcevo/facet-sdk`, `@arcevo/facet-components`,
  `@arcevo/facet-layout`, `@arcevo/facet-auth`, `@arcevo/facet-tokens`, `@arcevo/facet-store` —
  the **old** npm scope. Confirmed deliberate and roadmapped (see Facet, above), not accidental
  drift — though none of the four internal documents read in this pass mention the npm-namespace
  blocker explicitly; that explanation came directly from the architect, not from any ingested
  document. Worth Intel recording as architect-sourced context distinct from document-sourced
  evidence, since the two currently disagree on *why* by omission (the docs are simply silent on
  it, not contradictory).
- **AI-agent instructions**: `CLAUDE.md` + `AGENTS.md`, `.agent/` and `.commandcode/` present.

### `fusorb/relnex` (README, architecture doc, and roadmap all still say "Arcbase"/"Arc-ID") — VERIFIED, early/mid, rebuild in progress
- **Purpose**: Next.js 15 knowledge-graph content-management application, explicitly self-
  described in its own roadmap as "the knowledge-graph content management layer of the Arcevo
  ecosystem." Auth is **fully delegated externally** to SovGrant ("Arc-ID") — Relnex holds no
  identity logic of its own beyond a `User.identityId` bridge field.
- **Stack**: Next.js 15 App Router, TypeScript strict, pnpm, PostgreSQL via Prisma (16 models, 10
  enums, stated as "final" — no schema changes needed for current scope), S3-compatible storage
  (AWS S3 / Cloudflare R2), **shadcn/ui + Tailwind v4** for UI (~50 primitives) — not
  `@fusorb/facet-*`.
- **Real domain inventory, from `docs/architecture.md`**: `auth`, `users`, `resources` (14 flows —
  CRUD, relations, comments, versions, usage), `collections` (4 flows), `comments`, `tags`,
  `search`, `uploads` (S3 presigned URLs), `activity` (fire-and-forget logging). 39 API route
  files across 9 domains. Comments/tags/resources are first-class domain concepts from the
  ground up, not a generic CRUD layer with a knowledge-graph label bolted on.
- **Auth mechanics, confirmed precisely**: SovGrant issues a JWT on login; Relnex verifies it
  **locally via `jose` against a shared secret (`ARCID_JWT_SECRET`) — no network call on every
  request**. The roadmap explicitly compares this to "Clerk's model." A webhook channel
  (`POST /api/webhooks/arcid`, HMAC-signed) pushes identity lifecycle events
  (`IDENTITY_SUSPENDED`/`DELETED` → soft-delete; `USER_REGISTERED` → pre-provision) the other
  direction. The cross-service link itself is a **soft string reference, not a foreign key**:
  `User.identityId` matches SovGrant's `Identity.id` with no DB-level join possible across the
  service boundary — an important, concrete pattern for how Intel should model cross-repo
  relationships generally (data lives in two databases, linked by an opaque ID, not by a
  cross-database FK).
- **Architecture pattern**: same Flows/services/repositories domain pattern as SovGrant —
  `src/domains/{name}/{name}.dto.ts` (Zod), `{name}.service.ts`, `{name}.repository.ts`,
  `flows/{action}.flow.ts` — with an explicit import-boundary table (`@/core/auth` for guards,
  never `@/lib/arcid/middleware` directly; `@/core/db` for Prisma; `@/lib/arcid` for the SovGrant
  SDK client) and two named-deprecated import paths call out as errors to avoid
  (`@/lib/arcid/middleware`, `@/domains/auth/require-auth`).
- **Historical snapshot, dated 2026-07-27, from `docs/arcbase-roadmap.md` — read this as a
  point-in-time status, not necessarily current**: Prisma schema and auth infrastructure/context
  providers marked complete; **37 of 39 API routes were reported broken at import time** (missing
  `requireAuth`/`requireOnboarded`/`handleApiRoute` wiring); frontend pages partially built
  (login/register done, landing/onboarding/dashboard empty); no `CLAUDE.md`/`AGENTS.md` existed
  yet at that date. An ordered 8-workstream rebuild plan (Documentation → Core Infrastructure →
  Flow Unification → Auth Consolidation → Route Fix Pass → Edge Middleware → Pages → Polish) shows
  workstreams 1, 2, and 4 checked off as of that snapshot; 3, 5, 6, and 7 still open. Given the
  repo now shows 24 commits total (more than existed at the roadmap's own snapshot date), some of
  these later workstreams have very likely progressed since — **this file's own footer instructs
  every session to update it in the same commit that closes an item, so its current accuracy
  should be re-verified against the live repo rather than assumed from this read.**
- **Architectural-invariant violation, confirmed and now doubly verified**: per the architect,
  Facet is meant to be the ecosystem's single UI system with no framework exceptions — Relnex's
  direct use of shadcn/ui is a genuine current-state violation of a stated rule, and **neither of
  Relnex's own internal documents mentions any plan to migrate off shadcn/ui onto Facet** — this
  was an open question in earlier passes; having now read both documents, the absence of a stated
  plan is confirmed, not merely unfetched.
- **AI-agent instructions**: `.commandcode/`, `AGENTS.md`, `CLAUDE.md` present — same convention
  as the rest of the org.
- **Maturity**: 24 commits total as of this snapshot — meaningfully earlier-stage than SovGrant's
  95 commits / v1-complete status.

### `fusorb/sovport` (README and integration plan both still say "ArcWallet") — VERIFIED, pre-integration scaffold with a fully specified plan
- **Purpose**: self-sovereign identity wallet — the credential-holder counterpart to SovGrant's
  issuer/verifier role.
- **Stack**: Expo 57 + React Native 0.86, `expo-router` file-based routing, `pnpm`, planned
  `zustand` (matching SovGrant's own state pattern) and `expo-secure-store` for token persistence.
- **Explicit status, in the README itself**: *"Status (2026-08-05): blank Expo starter. The ArcID
  integration has not been built yet."* Ships the default Expo tabs template today.
- **The integration plan (`docs/arcwallet-integration-planning.md`, last verified 2026-08-05) is
  fully specified**, not just a name-and-scope stub. It defines the complete SDK contract SovPort
  will consume — `AuthSdk`, `PasskeySdk`, `VcSdk`, `IdentitySdk` (including
  `startOnboarding`/`getOnboardingProgress`/`advanceOnboarding`/`registerWalletDid`), `OAuthSdk`,
  `TenantSdk`, `BillingSdk`, `WebhooksSdk`, `AuditSdk`, `IdpSdk` — all already published and
  implemented server-side, not aspirational.
- **A cross-repo contract worth Intel modeling explicitly**: SovGrant already owns a complete
  onboarding system server-side (`OnboardingFlow` model scoped to a Project, `OnboardingProgress`
  tracking `currentStep`/`completedSteps`/`completedAt`, admin-defined flows, idempotent start) —
  SovPort's plan is explicit that **the wallet does not reimplement any of this tracking logic,
  only renders the frontend steps** (`WelcomeCard`, `FeatureHighlight`, `ActionPrompt`,
  `FormStep`, `BiometricSetup`, `CredentialIntro`). This is a clean, confirmed example of a
  cross-repo API contract Intel's graph should capture as a first-class relationship, not just
  "SovPort depends on SovGrant" at the repo level.
- **Planned build order, per the same document**: Phase 1 (auth, SDK foundation, onboarding
  screens), Phase 2 (wallet core — credential display via `VcSdk.list()`, issue/verify/offer
  flows, QR scanning, SD-JWT display/verification), Phase 3 (DID/identity — on-device keypair
  generation, `registerWalletDid` with only the public key sent to SovGrant, DID document
  display/resolution), Phase 4 (full integration — tenant switching, OAuth client management,
  webhook subscriptions, audit log queries, billing display).
- **Backend readiness, verified 2026-08-05, per the same document**: `GET /credentials`
  implemented, `registerWalletDid` implemented (non-custodial — only the public key ever leaves
  the device), Docker/compose infrastructure exists — all three explicitly called out as "no
  longer a blocker," implying an earlier version of this same plan had listed them as blockers.
- **The concrete naming candidate for a native UI package, direct from the document**: *"If shared
  RN UI is later desired, a new `@arcevo/facet-rn` package would be required — it is NOT a fork of
  the web library."* This is the ecosystem's own working name for what earlier architecture work
  (the facet-motion planning done in this same session) called `facet-native` — **these are not
  yet reconciled as the same planned artifact**, and Intel should treat "a native Facet UI driver"
  as one concept with two candidate names in circulation, not two separate planned systems, until
  confirmed otherwise.
- **Cross-repo doc-lag, confirmed a third time**: the README's "Related" links point to
  `github.com/arcevodev/arc-id` and `github.com/arcevodev/facet` — the old `arcevodev` org naming
  — even though the real repos live at `fusorb/sovgrant` and `fusorb/facet`.
- **AI-agent instructions**: `.agent/`, `.commandcode/` present even at this early stage.
- **Maturity**: 10 commits — earliest-stage of the four active product repos, but with the most
  fully-specified forward plan of any repo read in this session.

### `fusorb/intel` — VERIFIED, empty
1 commit, README only, "fusorb intelligence system..." as its only description. Genuine blank
slate — nothing to reconcile against existing code here, only against the rest of the ecosystem
it's meant to observe.

### `poetic-dev/arcevocirqle` (newer, no hyphen) — VERIFIED, near-empty
2 commits: `.gitignore` and `package.json` only, no README content, no description. Confirmed
genuinely fresh, not merely under-documented — this is now confirmed as the **public-facing
layer**, per the architect, once it has real content.

### `poetic-dev/arcevo-cirqle` (older, hyphenated) — VERIFIED, abandoned early scaffold
6 commits. The README is the **unedited default `create-next-app` boilerplate** — never
customized, so it carries no product narrative of its own. But the repo tree is real and tells a
genuine history story: a Turborepo monorepo (`turbo.json`, `pnpm-workspace.yaml`) containing
`apps/web` and `services/cirqle-api/src`. That's a **single-monorepo, one-API-plus-one-webapp**
shape — a materially different architecture from today's ecosystem, which is split into separate,
specialized repos (Facet, SovGrant, Relnex, SovPort) each owning one domain. This is the clearest
concrete evidence found in this session of the shape the ecosystem moved *away from*.

### `poetic-dev/fusorb` — VERIFIED empty as a repo; role now confirmed by the architect
1 commit: `.gitignore`, `package.json`, `pnpm-lock.yaml` only — no README, no source directories.
Its **intended role is now resolved directly, not inferred**: the architectural/product layer —
for developers, organizations, and integrators of Fusorb products, not the general public —
distinct from `arcevocirqle`'s public-facing role. The two are not competing candidates for one
HQ role; they're deliberately split by audience.

---

## D. Dependency graph

**Runtime dependencies (confirmed from code/docs):**
```
Relnex    ──auth (JWT, local verify via shared secret)──▶  SovGrant
Relnex    ◀──webhook (HMAC-signed identity lifecycle events)──  SovGrant
SovGrant frontend ──▶  @arcevo/facet-* (OLD scope)    [confirmed drift, deliberate + roadmapped]
SovPort   ──(planned)──▶  @arcevo/facet-sdk           [SDK only — the UI packages are web-only]
SovPort   ──(planned)──▶  SovGrant's onboarding system  [wallet renders steps; backend owns all
                                                          progress-tracking state]
```

**SDK dependencies:**
```
SovGrant's own roadmap plans extracting packages/cli into a standalone @arcevo/arcid-cli package
  (P1, currently paused pending API contract stability)
Facet already ships an SDK package (@fusorb/facet-sdk) that SovGrant's frontend *should* be on
  once the npm-org namespace clears
SovPort's plan depends on @arcevo/facet-sdk directly (v1.0.1, pure fetch, DOM-free) — confirmed
  runnable unchanged in React Native
```

**Conceptual dependencies (stated intent, some now precisely specified):**
```
SovPort ──(planned, 4-phase build order specified)──▶ SovGrant   (full credential lifecycle:
    onboarding → credential display/issue/verify → DID registration → tenant/OAuth/billing mgmt)
ArcVerify (named, not yet a repo) ──(planned)──▶ SovGrant   (presentation-verification counterpart)
@fusorb/facet-native (verified to exist, v0.1.0, unpublished) ──(planned)──▶ SovPort and any
    future native consumer of Facet's UI layer
```

**Planned-only (roadmap documents, not implemented):**
```
SovGrant v2: ArcWallet/SovPort integration (P0, not started), CLI extraction, OSS release,
  migration off @arcevo/facet-* once the @fusorb npm-org namespace clears
SovGrant v2+: ArcVerify (verifier-facing counterpart), credential revocation via status lists,
  a substantial deferred/exploratory backlog (BBS+, did:jwk, OIDC4VCI, OPA/Cedar, SCIM, etc.)
Relnex: workstreams 3/5/6/7 of its own rebuild roadmap (status as of this pass's read is a
  2026-07-27 snapshot, likely stale relative to the live repo — re-verify before relying on it);
  no stated plan to migrate off shadcn/ui onto Facet, confirmed absent after reading both of its
  internal docs
SovPort: all 4 build phases (currently a blank Expo starter); `@fusorb/facet-native` already
  exists in the Facet repo (v0.1.0, unpublished) as the RN motion driver for `@fusorb/facet-motion`
  — SovPort's own doc's `@arcevo/facet-rn` guess is superseded, not a separate artifact to build
```

No direct evidence was found of Facet depending on any other repo — it is a pure foundation
layer, consumed by others, dependent on nothing else in the ecosystem. Relnex's direct use of
shadcn/ui is, per the architect, **not an accepted architectural choice** — it is a confirmed
current-state violation of a stated invariant, and — now confirmed by reading Relnex's own two
internal documents — there is genuinely no stated remediation plan for it anywhere in the repo's
own record, unlike SovGrant's and SovPort's npm-scope situations, which are both explained and
(in SovGrant's case) explicitly roadmapped.

---

## E. Architecture graph

| Domain | Owner | Evidence |
|---|---|---|
| Identity, auth, credentials, tenancy, billing, onboarding-flow definition | SovGrant | VERIFIED — v1 complete per its own roadmap; onboarding system fully server-owned |
| UI components, design tokens, layout shells, forms (web) | Facet | VERIFIED — 114 components, 4-layer architecture; stated as the mandatory UI system ecosystem-wide |
| Knowledge/resource graph, comments, tags, collections, search, uploads, activity | Relnex | VERIFIED — full domain inventory read from its own architecture doc |
| Wallet / credential possession / native UI / onboarding-flow rendering | SovPort | VERIFIED (planned, fully specified) — currently owns its own native screens because Facet's UI packages don't run in React Native yet; a native UI package (name unreconciled: `facet-rn` vs. `facet-native`) would change this |
| Presentation verification (named, not yet built) | "ArcVerify" | Discovered this pass, from SovGrant's own v2+ roadmap — no repo exists yet |
| Cross-ecosystem intelligence | Intel (this project) | N/A — blank slate |
| Shared infra (CI conventions, agent instructions, changesets) | org-wide convention, not a package | VERIFIED — `CLAUDE.md`/`AGENTS.md`/`.agent`/`.commandcode` present identically in facet, sovgrant, relnex, and sovport |

Databases: **Postgres via Prisma** is the consistent choice across SovGrant and Relnex — Relnex's
own schema is stated as "final" at 16 models/10 enums (no graph database anywhere, despite the
"knowledge graph" framing — directly challenging brief rule 15: **the ecosystem's own current
answer is no**). Redis appears only in SovGrant, for token revocation and session state. SovPort,
being a client application, has no database of its own.

---

## F. Current-state vs. intended-state matrix

| System | Current | Planned | Historical |
|---|---|---|---|
| Facet | 114 components, **12 packages** (9 published + `motion`/`native`/`sandbox` unpublished at v0.1.0), live CI drift gates, actively published under `@fusorb/facet-*`, actively receiving new commits (192 commits) | Full `@fusorb` npm-org namespace clearance; publish `motion`/`native`/`sandbox` to npm and update the README package table | ArcUI |
| SovGrant | **v1 (0.1.0) complete** per its own roadmap — full identity/OAuth/VC/tenancy/billing/federation stack; frontend still on `@arcevo/facet-*` | **v2 active**: ArcWallet/SovPort integration (P0, not started), API keys (done), CLI extraction (paused), billing UI (in progress); **v2+**: ArcVerify, OSS release, credential revocation; migration onto `@fusorb/facet-*` once the namespace clears, then full build focus shifts to Relnex | ArcID |
| Relnex | Resource/collection/comment/tag/search/activity domains live per its architecture doc; auth fully externalized to SovGrant via local-JWT verification; UI on shadcn/ui; a 2026-07-27 roadmap snapshot shows most of an 8-workstream rebuild done, some open (re-verify against live repo) | Full rebuild completion per its own roadmap; second in ecosystem build priority after SovGrant, specifically to curb knowledge fragmentation; **no stated plan** to migrate off shadcn/ui onto Facet | ArcBase |
| SovPort | Blank Expo 57 / RN 0.86 starter (default tabs template); 10 commits | A fully-specified 4-phase integration plan against SovGrant's SDK; native screens owned by SovPort until `@fusorb/facet-native` (verified to exist, v0.1.0, unpublished) is consumed | ArcWallet |
| ArcVerify | Does not exist as a repo | Named in SovGrant's own v2+ roadmap as a verifier-facing counterpart | — (newly discovered, no prior name) |
| Intel | Empty repo, 1 commit | Everything in this report | — (new) |
| ArcevoCirqle | Public-facing ecosystem identity; `poetic-dev/arcevocirqle` (newer) is near-empty; `poetic-dev/arcevo-cirqle` (older) is an abandoned Turborepo scaffold | Evolution into FusorbHQ over ~2-3 years (explicitly not guaranteed); confirmed as the public-facing layer specifically | Started as a single monorepo (one API + one web app) before the ecosystem split into today's specialized, domain-owned repos |
| Fusorb | The org umbrella for facet/sovgrant/relnex/sovport/intel; `poetic-dev/fusorb` is a genuinely empty scaffold | Confirmed role: the architectural/product layer for developers, orgs, and integrators of Fusorb products | — |

---

## G. Fusorb architecture — what it represents today vs. what it should

**Today**, "Fusorb" is a GitHub organization (`github.com/fusorb`) that owns five repos (`facet`,
`sovgrant`, `relnex`, `sovport`, `intel`) with consistent engineering conventions (pnpm,
TypeScript strict, Prisma where there's a database, `CLAUDE.md`/`AGENTS.md`, `.agent`/
`.commandcode`) — but no actual "Fusorb" product, package, or shared library exists, and the
reserved `poetic-dev/fusorb` HQ-level repo is currently empty. It is a **naming and convention
layer**, not yet an architectural one.

**What it should represent architecturally**: standardizing the things Intel would otherwise have
to rediscover independently per-repo — the Flows/services/repositories domain pattern (SovGrant
and Relnex both already use it, down to identical naming conventions for guards and flow objects —
worth confirming whether independently converged or explicitly shared, see Open Items), the
`CLAUDE.md`/`AGENTS.md`/`.commandcode` agent-instruction convention (present in all four product
repos, including the barely-started SovPort), and eventually a genuinely shared
`@fusorb/facet-*` consumption story once the npm-org namespace clears. Fusorb doesn't need a
runtime package to be architecturally real — it needs its conventions written down once,
referenced by every repo, and checked by Intel rather than re-invented per project.

**The stated mission, in full**: break fragmentation; build tools and products that solve
fragmentation problems; simultaneously build the tools and the people/practices that ensure the
solution stays consistent. A tool that solves fragmentation once and then drifts — exactly the
`@arcevo/facet-*` scope lag, the total Arc-name persistence across every internal document, or
Relnex's un-remediated shadcn/ui usage, all independently confirmed in this report — hasn't
actually solved fragmentation, it's relocated it. Intel's evidence/graph model, built to catch
precisely that kind of drift, is the "tools and people that ensure consistency" half of the
mission, in infrastructure form.

**Stated build sequencing, once the `@fusorb` npm namespace clears**: SovGrant first, to full
maturity — already substantially there per its own v1-complete status — then Relnex, specifically
because it's planned to curb knowledge fragmentation the way SovGrant curbs identity fragmentation.

---

## H. ArcevoCirqle architecture — public vs. internal

The public/internal split is confirmed directly, not inferred: **`poetic-dev/arcevocirqle` (the
live, non-hyphenated repo) is the public-facing layer** — the live ecosystem the general public
interacts with. **`poetic-dev/fusorb` is the architectural/product layer — for developers,
organizations, and integrators of Fusorb products, not the general public.** These are not two
candidates for the same HQ role; they're deliberately split by audience.

In practice, neither of ArcevoCirqle's two known repos carries public content yet:
`poetic-dev/arcevocirqle` is an empty scaffold, and the older `poetic-dev/arcevo-cirqle` — while
it does contain real code — is an abandoned, never-rebranded Next.js/Turborepo starter
(`apps/web` + `services/cirqle-api`) with no product identity of its own. There is currently no
evidence of a live public-facing site, blog, or community surface tied to ArcevoCirqle. What
*should* stay public-facing is identity/narrative/community; what's already correctly internal —
and now has a confirmed home in `poetic-dev/fusorb` once that repo has real content — is the
architectural/integrator-facing material: engineering conventions, integration docs, and
eventually Intel's own outputs. The engineering substance itself (Facet, SovGrant, Relnex,
SovPort) stays under the `fusorb` org, a third layer distinct from both the public site and the
HQ/architecture repo. Intel's own knowledge base should track all three as separate evidence
domains — public narrative, integrator-facing architecture, and internal product code — with
different audiences and different trust levels; conflating them would be a design mistake.

---

## I. Intel architecture candidates

Presented without ranking, per the brief's explicit instruction.

### Candidate 1 — Retrieval-first knowledge service (thin, TypeScript-only)
A TypeScript/Node service that indexes repos (Tree-sitter for symbols, plain text/AST chunking
for docs), stores everything in Postgres + pgvector, and exposes tools (`search_repo`,
`read_file`, `find_symbol`, etc.) over an internal API or MCP. No dedicated ML layer — embeddings
come from a hosted API. The `IntelligenceProvider` interface wraps whichever hosted model answers
questions using retrieved evidence.
- **Advantages**: smallest surface area, fastest to a working v1, no Python/ML infra to run.
- **Disadvantages**: no path to fine-tuning or specialized models without bolting on a second
  stack later; embedding quality is whatever the hosted provider gives you.
- **Scaling**: fine for the ecosystem's current five repos; pgvector scales adequately into the
  low millions of chunks before needing a dedicated vector store.
- **Model independence**: high.
- **Cross-repo capability**: good — a single Postgres schema can hold entities/relationships
  across all repos from day one.
- **Security**: smallest attack surface — no code execution boundary to secure.
- **Long-term viability**: strong as a foundation; would need a second track bolted on later if
  fine-tuning ever becomes justified.

### Candidate 2 — Agent-and-tools architecture (TypeScript orchestrator, tool-calling loop)
Builds an actual agent loop on top of Candidate 1's retrieval — the model plans, calls tools
(`find_callers`, `trace_dependency`, `run_tests`, `inspect_git_history`), and iterates. Modes
(ASK/TRACE/EXPLAIN/GUARD/REVIEW/PLAN/LEARN) become literal agent behaviors.
- **Advantages**: naturally supports GUARD/REVIEW/PLAN modes needing multi-step reasoning.
- **Disadvantages**: tool-execution security (sandboxing, prompt injection from untrusted repo
  content) becomes a first-class concern immediately, not a later add-on.
- **Scaling**: orchestration overhead grows with tool count and traversal depth; needs real
  observability from day one.
- **Model independence**: medium — tool-calling formats differ enough between providers.
- **Cross-repo capability**: excellent — answers "what depends on this" via live traversal.
- **Security**: the most sensitive of the four — requires the security investigation (brief
  section 16) resolved first, not concurrently.
- **Long-term viability**: strong, but only if the security work happens up front.

### Candidate 3 — Knowledge-graph-first architecture (explicit entity/relationship model)
Builds a genuine typed knowledge graph (repository → package → module → symbol → API → schema →
service → identity → tenant → decision) as the primary data model, with retrieval and the LLM as
*consumers* of the graph.
- **Advantages**: closest fit to the brief's stated priority for Relnex specifically ("a
  trackable, provable, evolvable knowledge base").
- **Disadvantages**: highest up-front design cost — a wrong early schema propagates everywhere.
- **Scaling**: a relational schema (Postgres, not a dedicated graph database) carries this far
  past what five repos need — directly addressing brief rule 15.
- **Model independence**: high.
- **Cross-repo capability**: the best of the four by design — e.g. SovPort's confirmed
  onboarding-system contract with SovGrant becomes first-class graph data, not an inferred fact.
- **Security**: moderate — same untrusted-content concerns as Candidate 2 apply once agents write
  back into the graph, but a graph without an agent loop is safer than one with.
- **Long-term viability**: the strongest long-term bet if Relnex's own future depends on the same
  modeling discipline — only if the initial schema stays deliberately small.

### Candidate 4 — Full research platform (TypeScript system + Python ML layer)
Builds Candidate 3's graph as the system layer, adds a genuine Python ML track (PyTorch/Hugging
Face) for embeddings, evaluation datasets, and eventual fine-tuning.
- **Advantages**: only candidate that opens a path to fine-tuning without a later migration.
- **Disadvantages**: by far the most infrastructure for a repo with 1 commit; risk of building
  capacity for a problem that doesn't exist yet, which the brief itself warns against.
- **Scaling/security/model-independence**: inherits everything from Candidate 3, plus a Python
  execution environment to secure and keep in sync.
- **Long-term viability**: real, but premature as a *starting* architecture — a destination, not
  a first step.

---

## J. Recommended architecture

**Recommendation: Candidate 3 (knowledge-graph-first), built as a TypeScript-only system with no
agent loop and no Python layer in v1 — Candidate 1's retrieval discipline wrapped around
Candidate 3's explicit graph, deliberately deferring Candidate 2's agent loop and Candidate 4's ML
layer.**

**Why**: the brief supplies the deciding evidence directly — the durable Fusorb asset is the
intelligence infrastructure, knowledge, evaluation system, provenance, tools and architecture, not
merely the underlying model — and this is specifically true of Relnex, whose own purpose ("a
trackable, provable, evolvable knowledge base") makes Intel's graph modeling a direct proving
ground for patterns Relnex itself may need. Having now read all four internal planning documents,
this recommendation is *strengthened*, not just unchanged: the ecosystem already has real,
specific cross-repo contracts (SovGrant's onboarding system, the soft-reference identity bridge,
the shared-secret JWT verification pattern) that are exactly graph-shaped facts, not retrieval-
shaped ones — a pure retrieval system would surface the right document, but a graph is what lets
Intel answer "what does SovPort actually depend on in SovGrant, precisely" without re-deriving it
from prose each time.

**What this optimizes for**: durability of the data model over speed of the demo, and evidence
quality (every graph edge traceable to a source file, README line, commit, or explicit UNKNOWN,
with a timestamp — see the test-count example in section C) over conversational polish.

**What this deliberately does not optimize for**: multi-step autonomous reasoning (no agent loop
yet), and model specialization (no fine-tuning track yet).

**What this depends on**: that the ecosystem's actual entity/relationship shapes generalize into
one schema without forcing awkward fits. This is now considerably better-verified than in earlier
passes — all four flagged planning documents have been read, and the domain shapes across SovGrant
and Relnex converge cleanly (both use the same Flows/DTO/service/repository pattern, both expose
similar guard/session primitives). The one remaining structural unknown is whether that
convergence is a shared, intentional Fusorb-level convention or independent parallel invention
(see Open Items) — the graph schema should probably model it as a first-class "pattern" entity
either way, since Intel will need to represent it regardless of its origin.

**What could invalidate this**: Relnex's own roadmap shows a rebuild in progress as of a
2026-07-27 snapshot that is likely stale relative to the live repo — if the rebuild changes
Relnex's domain shape materially before Intel's graph schema is finalized, that part of the schema
may need revisiting. Worth a fresh read of Relnex's current state immediately before finalizing
the entity model, not just relying on this pass's reads.

---

## K. Proposed Intel repository architecture

```
intel/
├── apps/
│   └── api/                  # Fastify service (matches SovGrant's stack choice — no reason
│                              # to introduce a second backend framework into the org)
├── packages/
│   ├── graph/                 # entity/relationship model + Postgres/Prisma schema
│   │                          # (repository, package, module, symbol, api, schema-table,
│   │                          #  service, identity, tenant, decision, document, version,
│   │                          #  commit, author, relationship, pattern — start with the
│   │                          #  smallest subset that answers real questions)
│   ├── ingest/                 # repo ingestion: git clone/fetch, Tree-sitter parsing,
│   │                          # README/doc parsing, commit history walk
│   ├── evidence/               # the VERIFIED/STRONGLY-SUPPORTED/INFERRED/UNKNOWN model,
│   │                          # provenance (source path + commit SHA + timestamp) attached
│   │                          # to every graph fact — including which document a fact came
│   │                          # from when documents disagree (see the test-count example)
│   ├── retrieval/              # hybrid lexical + embedding search over ingested content,
│   │                          # thin — a consumer of `graph`, not a parallel data model
│   ├── provider/               # the IntelligenceProvider interface + one hosted-API
│   │                          # implementation (no local/open-weight model in v1)
│   └── tools/                 # the read-only tool surface: search_repo, read_file,
│                              # find_symbol, find_references, inspect_git_history
├── docs/
│   └── architecture.md         # this report's living successor
├── schemas/
│   └── graph.prisma            # the actual schema, versioned like every other repo's Prisma
└── AGENTS.md / CLAUDE.md       # same convention as facet/sovgrant/relnex/sovport
```

No `python/` directory in v1 — Candidate 4's ML layer is deferred.

---

## L. First implementation milestone

**Smallest useful Intel system**: ingest `facet`, `sovgrant`, `relnex`, and `sovport`, build the
graph's smallest viable entity set (repository, package, module, symbol, document — five types),
attach evidence/provenance with timestamps to every fact, and expose exactly one tool-shaped
question-answering path: given a question, retrieve relevant graph nodes + source snippets, answer
with citations back to file paths and commit context, and say UNKNOWN rather than guess when the
graph doesn't cover it.

**Two concrete tests this milestone should pass, now that real documents have been read**:
1. Ask "why does SovGrant's frontend import `@arcevo/facet-sdk` instead of `@fusorb/facet-sdk`?"
   — Intel should surface the discrepancy with citations, and correctly say it doesn't know the
   npm-namespace reason *unless that reason has itself been ingested from somewhere durable*
   (none of the four internal documents state it — only this conversation does). Saying UNKNOWN
   here, until the explanation is itself a recorded document, is the milestone passing.
2. Ask "how many tests does SovGrant have?" — a system without temporal awareness will pick one
   number and be confidently wrong relative to at least one real source document. Intel passing
   this milestone means it either asks which date's snapshot is wanted, or answers with the date
   attached ("as of 2026-09-01, per the v2 roadmap: 358").

No chat UI, no agent loop, no fine-tuning — ingestion, the graph, evidence, and one honest
question-answering path.

---

## M. Future evolution

```
Repository Intelligence        (this milestone — ingest, graph, evidence, cite, with timestamps)
        ↓
Architectural Intelligence     (cross-repo relationships live in the graph — SovPort's onboarding
                                contract with SovGrant as the first fully-specified example —
                                Candidate 2's tool-calling added once the graph is trustworthy
                                enough to be worth traversing live)
        ↓
Engineering Intelligence       (GUARD/REVIEW/PLAN modes — e.g. catching a new Relnex-style
                                shadcn/ui violation of the Facet invariant automatically, or
                                flagging a new repo that reintroduces an Arc- name in a README;
                                requires the security work from brief section 16 solved first)
        ↓
Fusorb Intelligence            (temporal knowledge — "why did ArcID become SovGrant," "why is
                                SovGrant still on @arcevo/facet-*," or "which of these three test
                                counts is current" all answerable once ADRs and dated snapshots
                                are systematically ingested, not just this session's one-off reads)
        ↓
Potential Specialized Model    (Candidate 4's ML layer — only if evaluation data shows a hosted
                                model is genuinely the bottleneck, not before)
```

---

## Open items requiring your input

1. **Resolved this pass**: whether Relnex has a stated plan to migrate off shadcn/ui onto Facet —
   confirmed absent, after reading both `docs/architecture.md` and `docs/arcbase-roadmap.md`.
2. **Still open**: confirm whether SovGrant's Flows pattern and Relnex's Flows pattern were
   independently built or already share code/convention — both documents describe near-identical
   patterns (Zod DTOs, `{name}.service.ts`/`{name}.repository.ts`, `Flow<I,O>` objects run through
   a `FlowExecutor`), which is either a real shared Fusorb-level convention worth naming
   explicitly, or a striking coincidence worth understanding.
3. **Resolved this pass**: the `@arcevo/facet-rn` vs. `facet-native` naming question — the actual
   package, verified directly in the repo, is `@fusorb/facet-native` (v0.1.0, unpublished), a
   React Native motion driver for the also-newly-verified `@fusorb/facet-motion`. SovPort's own
   planning doc's `@arcevo/facet-rn` guess is superseded, not a second artifact to reconcile.
4. **Newly surfaced**: "ArcVerify," named in SovGrant's own v2+ roadmap as a verifier-facing
   counterpart, has no repo yet — worth deciding now whether it's a genuinely separate future
   product (a sixth entry in the ecosystem map) or a module that might live inside SovGrant itself.
5. **Newly surfaced**: confirm what `@fusorb/facet-sandbox` (a framework-agnostic live-preview
   engine, verified this pass, unpublished at v0.1.0) is for — specifically whether it's the
   engine underneath `facet-docs`'s `<InteractiveDemo>` component, a replacement for it, or an
   unrelated capability. This also directly affects the facet-motion Phase 2 plan from earlier in
   this session, which assumed the docs-integrated playground had no dedicated engine package.
6. **Still open**: decide whether Intel should treat `poetic-dev/arcevo-cirqle`'s old `cirqle-api`
   service as dead history or as something worth mining for its domain shape, even though it's
   not a live dependency of anything today.
7. **Still open**: Relnex's own roadmap doc is a 2026-07-27 snapshot that its own footer says
   should be kept current in the same commit as any closed item — worth a fresh read of the live
   repo's actual current state before Intel's graph schema is finalized against it, since the
   repo's commit count suggests real progress has happened since that snapshot.