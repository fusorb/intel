/**
 * ADR-derived decision seeds.
 *
 * Reads the vendored architecture-repo ADRs under `vendor/fusorb/decisions/*.md`
 * (sorted by filename) and turns each into a `DecisionSeed`. The vendored tree is
 * pinned by `vendor/fusorb/PROVENANCE.json`, whose `sourceCommit` supplies
 * `sourceCommitSha`.
 *
 * The vendor directory is resolved from the repo root via `process.cwd()`, because
 * this runs through tsx from the repo root (`pnpm seed:governance`) and through
 * vitest from the repo root. If `vendor/fusorb/decisions` is missing we fail loudly
 * rather than seed an empty set.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { resolve } from "node:path"
import type { DecisionSeed, DecisionTarget } from "./decisions.js"

/** `decisions/0005-ui-invariant.md` — the ADR that defines the UI invariant. */
export const UI_INVARIANT_SOURCE_PATH = "decisions/0005-ui-invariant.md"

/**
 * `decisions/0000-template.md` — the ADR scaffold, vendored alongside the real
 * ADRs. It is the blank template, not a decision, so `loadAdrDecisions()` skips it.
 */
export const ADR_TEMPLATE_FILE = "0000-template.md"

const FRONTMATTER_FENCE = /^---\s*$/
const BLOCK_ITEM = /^\s*-\s+(.*)$/
const KEY_VALUE = /^([A-Za-z0-9_.-]+):\s*(.*)$/
const H1 = /^#\s+(.+?)\s*$/
const H2 = /^##\s+(.+?)\s*$/
const CODE_FENCE = /^\s*```/
/** A leading ordinal on an H1, e.g. `7. ` in `# 7. SovGrant is the ...`. */
const ORDINAL_PREFIX = /^\d+\.\s+/

export type FrontmatterValue = string | string[]
export type Frontmatter = Record<string, FrontmatterValue>

export interface ParsedAdr {
  data: Frontmatter
  body: string
}

function stripQuotes(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length >= 2) {
    const first = trimmed[0]
    const last = trimmed[trimmed.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1)
    }
  }
  return trimmed
}

/**
 * Parse the leading YAML frontmatter block. Intentionally tiny — it handles the
 * shapes the vendored ADRs use: scalar `key: value`, inline lists `key: [a, b]`,
 * and block lists (`key:` followed by `- item` lines). A missing or unclosed
 * block yields no data and the whole text as the body.
 */
export function parseFrontmatter(raw: string): ParsedAdr {
  const text = raw.replace(/^\uFEFF/, "")
  const lines = text.split(/\r?\n/)
  if (lines[0]?.trim() !== "---") {
    return { data: {}, body: text.trim() }
  }

  let end = -1
  for (let i = 1; i < lines.length; i++) {
    if (FRONTMATTER_FENCE.test(lines[i] ?? "")) {
      end = i
      break
    }
  }
  if (end === -1) {
    return { data: {}, body: text.trim() }
  }

  const data: Frontmatter = {}
  let currentKey: string | null = null

  for (let i = 1; i < end; i++) {
    const line = lines[i] ?? ""
    if (line.trim() === "") continue

    const item = BLOCK_ITEM.exec(line)
    if (item && currentKey) {
      const value = stripQuotes(item[1] ?? "")
      const existing = data[currentKey]
      if (Array.isArray(existing)) existing.push(value)
      else data[currentKey] = [value]
      continue
    }

    const kv = KEY_VALUE.exec(line)
    if (!kv) continue
    const key = kv[1] ?? ""
    const rest = (kv[2] ?? "").trim()
    currentKey = key
    if (rest === "") {
      data[key] = []
    } else if (rest.startsWith("[") && rest.endsWith("]")) {
      data[key] = rest
        .slice(1, -1)
        .split(",")
        .map((s) => stripQuotes(s))
        .filter((s) => s.length > 0)
    } else {
      data[key] = stripQuotes(rest)
    }
  }

  return { data, body: lines.slice(end + 1).join("\n").trim() }
}

/** The first H1 in the body, with any leading `N. ` ordinal stripped. */
export function extractTitle(body: string): string {
  for (const line of body.split(/\r?\n/)) {
    const match = H1.exec(line)
    if (match) {
      return (match[1] ?? "").trim().replace(ORDINAL_PREFIX, "")
    }
  }
  return ""
}

/**
 * Verbatim body of an `## <heading>` section: from the line after the heading to
 * the next level-2 heading (`## `) or end of body. `###` subheadings and fenced
 * code blocks (which may themselves contain `## ` lines) are kept inside the
 * section — a heading match only counts outside a code fence.
 */
export function extractSection(body: string, heading: string): string {
  const target = heading.trim().toLowerCase()
  const lines = body.split(/\r?\n/)

  let start = -1
  let inFence = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ""
    if (CODE_FENCE.test(line)) inFence = !inFence
    if (inFence) continue
    const match = H2.exec(line)
    if (match && (match[1] ?? "").trim().toLowerCase() === target) {
      start = i + 1
      break
    }
  }
  if (start === -1) return ""

  const collected: string[] = []
  let fence = false
  for (let i = start; i < lines.length; i++) {
    const line = lines[i] ?? ""
    if (CODE_FENCE.test(line)) fence = !fence
    if (!fence && H2.test(line)) break
    collected.push(line)
  }
  return collected.join("\n").trim()
}

const ACTIVE_STATUSES = new Set(["accepted", "active", "approved"])
const PROPOSED_STATUSES = new Set([
  "proposed",
  "draft",
  "provisional",
  "in review",
  "in-review",
])
const SUPERSEDED_STATUSES = new Set(["superseded", "rejected", "deprecated", "retired"])
const DEFERRED_STATUSES = new Set(["deferred", "on hold", "on-hold", "paused"])

/**
 * Map an ADR frontmatter `status` to the Decision status enum (`active` |
 * `proposed` | `superseded` | `deferred`). The mapping is FAITHFUL — it records
 * what the ADR says rather than asserting a decision is in force:
 *
 *   accepted / active / approved                          -> `active`
 *   proposed / draft / provisional / in review / in-review -> `proposed`
 *   superseded / rejected / deprecated / retired          -> `superseded`
 *   deferred / on hold / on-hold / paused                 -> `deferred`
 *   (anything else)                                       -> `proposed`
 *
 * The arch repo labels EVERY ADR `Proposed` — including load-bearing ones like
 * "SovGrant is the canonical IdP" — because `status` there tracks that repo's
 * document-review lifecycle, not whether the decision is in force. `proposed`
 * therefore means "recorded but not ratified". Visibility is a SEPARATE concern
 * from `status`: the read path (`getActiveDecisions()` in packages/retrieval, and
 * the API `/decisions` route that reads through it) surfaces every decision that
 * is not retired — `status` in {`active`, `proposed`} — so a `proposed` decision
 * stays visible while carrying its honest label. Unknown values also resolve to
 * `proposed`, the conservative choice: an unrecognised status must never assert a
 * decision is in force.
 */
export function mapStatus(raw: string): DecisionSeed["status"] {
  const status = raw.trim().toLowerCase()
  if (ACTIVE_STATUSES.has(status)) return "active"
  if (PROPOSED_STATUSES.has(status)) return "proposed"
  if (SUPERSEDED_STATUSES.has(status)) return "superseded"
  if (DEFERRED_STATUSES.has(status)) return "deferred"
  return "proposed"
}

/** The repo root, assumed to be the process working directory. */
export function defaultVendorDir(): string {
  return resolve(process.cwd(), "vendor", "fusorb")
}

interface EcosystemFile {
  orgs?: Array<{ id?: unknown }>
  layers?: Array<{ id?: unknown }>
  products?: Array<{ id?: unknown }>
}

/**
 * Every id known to `vendor/fusorb/ecosystem.json` — org, layer, and product ids.
 * ADR `governs` entries are only meaningful when they reference one of these
 * (ADR 0007 states the restriction explicitly).
 */
export function loadEcosystemIds(vendorDir: string): Set<string> {
  const path = resolve(vendorDir, "ecosystem.json")
  const parsed = JSON.parse(readFileSync(path, "utf8")) as EcosystemFile
  const ids = new Set<string>()
  for (const group of [parsed.orgs, parsed.layers, parsed.products]) {
    for (const item of group ?? []) {
      if (item && typeof item.id === "string") ids.add(item.id)
    }
  }
  return ids
}

/**
 * The ecosystem ids the graph can actually anchor an edge to — the ids of
 * `products`. Orgs and layers are decided ecosystem facts, not graph entities:
 * the graph models products as `Repository` rows, so only a product id can be
 * the target of a GOVERNS edge. Non-product ids are dropped without warning.
 *
 * If the foundation repos (`fusorb`, `arcevocirqle` — ingested as layers) are
 * ever added to the graph, add `parsed.layers` here and their ADRs' GOVERNS
 * edges appear — a single, deliberate flip.
 */
export function loadGovernableIds(vendorDir: string): Set<string> {
  const path = resolve(vendorDir, "ecosystem.json")
  const parsed = JSON.parse(readFileSync(path, "utf8")) as EcosystemFile
  const ids = new Set<string>()
  for (const item of parsed.products ?? []) {
    if (item && typeof item.id === "string") ids.add(item.id)
  }
  return ids
}

/**
 * Project ADR `governs` ids onto graph-addressable targets, splitting three ways:
 *
 *  - `governs` — ids the graph models (`products`); become REPOSITORY targets.
 *  - `notGovernable` — known ecosystem ids the graph does not model (orgs and
 *    layers). Out of scope by design, so dropped without a warning.
 *  - `unknown` — ids absent from ecosystem.json entirely; an editorial error
 *    (typo, retired id) and warned about.
 */
export function toGoverns(
  ids: readonly string[],
  validIds: ReadonlySet<string>,
  governableIds: ReadonlySet<string>,
): { governs: DecisionTarget[]; notGovernable: string[]; unknown: string[] } {
  const governs: DecisionTarget[] = []
  const notGovernable: string[] = []
  const unknown: string[] = []
  for (const id of ids) {
    if (!validIds.has(id)) {
      unknown.push(id)
    } else if (!governableIds.has(id)) {
      notGovernable.push(id)
    } else {
      governs.push({ type: "REPOSITORY", repository: id })
    }
  }
  return { governs, notGovernable, unknown }
}

interface ProvenanceFile {
  sourceCommit?: unknown
}

/**
 * Abbreviated commit length for provenance. Git's `--short` auto-scales past 7
 * hex chars on large repos; this repo already committed the 8-char abbreviation
 * "9d44c40e" as the hand-authored seeds' `ARCH_REPO_COMMIT`. We use the same
 * length so every seeded decision shares one provenance sha for the vendored tree.
 */
const SHORT_SHA_LENGTH = 8

/** The short source commit from `vendor/fusorb/PROVENANCE.json` (e.g. `9d44c40e`). */
export function loadSourceCommitSha(vendorDir: string): string {
  const path = resolve(vendorDir, "PROVENANCE.json")
  const parsed = JSON.parse(readFileSync(path, "utf8")) as ProvenanceFile
  const commit = parsed.sourceCommit
  if (typeof commit !== "string" || commit.length < SHORT_SHA_LENGTH) {
    throw new Error(
      `Malformed vendor provenance: ${path} has no valid "sourceCommit" string. ` +
        `Run "pnpm sync:fusorb" to regenerate the vendored snapshot.`,
    )
  }
  return commit.slice(0, SHORT_SHA_LENGTH)
}

function asString(value: FrontmatterValue | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "")
}

function asStringArray(value: FrontmatterValue | undefined): string[] {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

/**
 * Parse every vendored ADR into a `DecisionSeed`, sorted by filename. The ADR
 * template (`0000-template.md`) is skipped — it is a scaffold, not a decision.
 *
 * `key` is the filename stem (the ADR's stable ordinal slug, e.g.
 * `0007-identity-authority`) — it is stable and human-readable, and it is what
 * replaced the old hand-authored keys (`identity-authority` etc.). `title` is the
 * H1 with its `N. ` ordinal stripped; `statement` is the verbatim `## Decision`
 * body; `sourcePath` is `decisions/<file>`; `sourceCommitSha` is the short sha
 * from PROVENANCE.json.
 */
export function loadAdrDecisions(vendorDir: string = defaultVendorDir()): DecisionSeed[] {
  const decisionsDir = resolve(vendorDir, "decisions")
  if (!existsSync(decisionsDir)) {
    throw new Error(
      `Vendored ADR directory not found: ${decisionsDir}. ` +
        `Run this from the repo root (it is resolved from process.cwd()) and ensure ` +
        `"vendor/fusorb/decisions" exists — run "pnpm sync:fusorb" if it is missing.`,
    )
  }

  const validIds = loadEcosystemIds(vendorDir)
  const governableIds = loadGovernableIds(vendorDir)
  const sourceCommitSha = loadSourceCommitSha(vendorDir)

  const files = readdirSync(decisionsDir)
    .filter((name) => name.endsWith(".md"))
    // `0000-template.md` is the ADR template scaffold, not a decision — skip it so
    // it never becomes a seeded Decision.
    .filter((name) => name !== ADR_TEMPLATE_FILE)
    .sort()

  // Ids an ADR governs that the graph does not model (org/layer ids). These are
  // out of scope by design, so they are collected across all ADRs and reported
  // once at info — never warned per file.
  const outOfScope = new Set<string>()

  const seeds = files.map((file) => {
    const raw = readFileSync(resolve(decisionsDir, file), "utf8")
    const { data, body } = parseFrontmatter(raw)
    const { governs, notGovernable, unknown } = toGoverns(
      asStringArray(data.governs),
      validIds,
      governableIds,
    )
    if (unknown.length > 0) {
      console.warn(
        `[adr] ${file}: dropping unknown governs id(s) (not in ecosystem.json): ${unknown.join(", ")}`,
      )
    }
    for (const id of notGovernable) outOfScope.add(id)
    return {
      key: file.replace(/\.md$/, ""),
      title: extractTitle(body),
      statement: extractSection(body, "Decision"),
      status: mapStatus(asString(data.status)),
      sourcePath: `decisions/${file}`,
      sourceCommitSha,
      governs,
    }
  })

  if (outOfScope.size > 0) {
    console.info(
      `[adr] governs ids outside the graph's scope (not modeled as repositories): ` +
        [...outOfScope].sort().join(", "),
    )
  }

  return seeds
}
