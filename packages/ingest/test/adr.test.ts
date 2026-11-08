import { describe, it, expect } from "vitest"
import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  loadAdrDecisions,
  parseFrontmatter,
  extractTitle,
  extractSection,
  mapStatus,
  loadEcosystemIds,
  toGoverns,
  loadSourceCommitSha,
  defaultVendorDir,
  UI_INVARIANT_SOURCE_PATH,
  ECOSYSTEM_DECISIONS,
  type DecisionSeed,
} from "@fusorb/intel-ingest"

const __dirname = fileURLToPath(new URL(".", import.meta.url))
/** Repo-root `vendor/fusorb`, reached from `packages/ingest/test/` — independent of cwd. */
const VENDOR = resolve(__dirname, "../../../vendor/fusorb")

const EXPECTED_ADR_KEYS = [
  "0001-role-and-boundary",
  "0002-ecosystem-json-canonical",
  "0003-naming-ledger",
  "0004-content-format",
  "0005-ui-invariant",
  "0006-hosting-and-domain-model",
  "0007-identity-authority",
  "0008-consumer-sync",
]

describe("parseFrontmatter", () => {
  it("parses scalar values and inline lists", () => {
    const raw = ["---", "status: Proposed", "governs: [fusorb, facet]", "---", "# Title", "", "body"].join("\n")
    const { data, body } = parseFrontmatter(raw)
    expect(data.status).toBe("Proposed")
    expect(data.governs).toEqual(["fusorb", "facet"])
    expect(body).toBe("# Title\n\nbody")
  })

  it("parses block lists", () => {
    const raw = ["---", "status: Proposed", "governs:", "  - sovgrant", "  - relnex", "---", "body"].join("\n")
    const { data, body } = parseFrontmatter(raw)
    expect(data.governs).toEqual(["sovgrant", "relnex"])
    expect(body).toBe("body")
  })

  it("treats text without a frontmatter block as all body", () => {
    const { data, body } = parseFrontmatter("# No frontmatter\n\ntext")
    expect(data).toEqual({})
    expect(body).toBe("# No frontmatter\n\ntext")
  })

  it("does not treat an unclosed block as frontmatter", () => {
    const { data, body } = parseFrontmatter("---\nstatus: Proposed\n\n# Title")
    expect(data).toEqual({})
    expect(body).toContain("# Title")
  })
})

describe("extractTitle", () => {
  it("strips a leading N. ordinal from the H1", () => {
    expect(extractTitle("# 7. SovGrant is the canonical identity provider\n\n## Context")).toBe(
      "SovGrant is the canonical identity provider",
    )
  })

  it("leaves an H1 without an ordinal untouched", () => {
    expect(extractTitle("# ADR 0008: Consumer sync via vendored snapshot")).toBe(
      "ADR 0008: Consumer sync via vendored snapshot",
    )
  })

  it("ignores H2 headings when locating the H1", () => {
    expect(extractTitle("## Decision\n\n# Real title")).toBe("Real title")
  })
})

describe("extractSection", () => {
  const body = [
    "# Doc",
    "",
    "## Context",
    "context text",
    "",
    "## Decision",
    "The canonical rule.",
    "### Sub",
    "sub detail",
    "",
    "```json",
    '{ "## not a heading": true }',
    "```",
    "",
    "last line of the decision.",
    "",
    "## Alternatives",
    "alternative text",
  ].join("\n")

  it("returns the verbatim body between the heading and the next H2", () => {
    const decision = extractSection(body, "Decision")
    expect(decision).toContain("The canonical rule.")
    expect(decision).toContain("### Sub")
    expect(decision).toContain("last line of the decision.")
    // `## ` inside a fenced code block is not a boundary
    expect(decision).toContain('{ "## not a heading": true }')
  })

  it("stops at the next H2 and excludes it", () => {
    const decision = extractSection(body, "Decision")
    expect(decision).not.toContain("alternative text")
    expect(decision).not.toContain("## Alternatives")
    expect(decision).not.toContain("context text")
  })

  it("does not confuse a sibling subheading (###) for the section boundary", () => {
    const sub = extractSection("## Decision\na\n### Sub\nb\n## Alternatives\nc", "Decision")
    expect(sub).toBe("a\n### Sub\nb")
  })

  it("returns an empty string when the heading is absent", () => {
    expect(extractSection(body, "Nonexistent")).toBe("")
  })
})

describe("mapStatus", () => {
  it("maps Accepted/Active and the arch repo's Proposed/Draft to active", () => {
    // "Proposed" -> active is deliberate: every vendored ADR is "Proposed" and
    // mapping it to "deferred" would hide all of them from getActiveDecisions().
    for (const raw of ["Accepted", "Active", "Proposed", "Draft", "propOSed", "  active "]) {
      expect(mapStatus(raw)).toBe("active")
    }
  })

  it("maps Superseded and Rejected to superseded", () => {
    for (const raw of ["Superseded", "Rejected", "Deprecated", "Retired"]) {
      expect(mapStatus(raw)).toBe("superseded")
    }
  })

  it("maps Deferred to deferred", () => {
    expect(mapStatus("Deferred")).toBe("deferred")
    expect(mapStatus("on hold")).toBe("deferred")
  })

  it("never silently hides an unknown status", () => {
    expect(mapStatus("something-new")).toBe("active")
  })
})

describe("governs filtering against ecosystem.json", () => {
  it("exposes the ecosystem ids (orgs, layers, products)", () => {
    const ids = loadEcosystemIds(VENDOR)
    for (const id of ["fusorb", "arcevocirqle", "facet", "sovgrant", "relnex", "sovport", "intel"]) {
      expect(ids.has(id)).toBe(true)
    }
  })

  it("keeps known ids and drops ids absent from ecosystem.json", () => {
    const ids = loadEcosystemIds(VENDOR)
    const { governs, dropped } = toGoverns(["facet", "scholium", "relnex"], ids)
    expect(governs).toEqual([
      { type: "REPOSITORY", repository: "facet" },
      { type: "REPOSITORY", repository: "relnex" },
    ])
    expect(dropped).toEqual(["scholium"])
  })

  it("drops every ADR governs id that is not a known ecosystem id", () => {
    const ids = loadEcosystemIds(VENDOR)
    const { governs, dropped } = toGoverns(["not-a-real-id", "facet"], ids)
    expect(governs.map((g) => g.repository)).toEqual(["facet"])
    expect(dropped).toEqual(["not-a-real-id"])
  })

  it("resolves every real ADR governs entry within ecosystem.json", () => {
    const ids = loadEcosystemIds(VENDOR)
    for (const seed of loadAdrDecisions(VENDOR)) {
      for (const target of seed.governs) {
        expect(ids.has(target.repository)).toBe(true)
      }
    }
  })
})

describe("loadAdrDecisions", () => {
  const seeds = loadAdrDecisions(VENDOR)

  it("loads exactly the 8 vendored ADRs, sorted by filename", () => {
    expect(seeds).toHaveLength(8)
    expect(seeds.map((s) => s.key)).toEqual(EXPECTED_ADR_KEYS)
  })

  it("gives every ADR a stable filename-stem key and matching sourcePath", () => {
    for (const seed of seeds) {
      expect(seed.key).toMatch(/^\d{4}-[a-z0-9-]+$/)
      expect(seed.sourcePath).toBe(`decisions/${seed.key}.md`)
    }
  })

  it("derives a non-empty, ordinal-free title for every ADR", () => {
    for (const seed of seeds) {
      expect(seed.title.length).toBeGreaterThan(0)
      expect(seed.title).not.toMatch(/^\d+\.\s/)
      expect(seed.title).not.toMatch(/^#/)
    }
  })

  it("extracts a non-empty verbatim ## Decision statement for every ADR", () => {
    for (const seed of seeds) {
      expect(seed.statement.length).toBeGreaterThan(0)
      expect(seed.statement).not.toMatch(/^##\s/m)
      expect(seed.statement).not.toContain("## Alternatives")
    }
  })

  it("maps every vendored ADR to an active status", () => {
    for (const seed of seeds) {
      expect(seed.status).toBe("active")
    }
  })

  it("uses the short provenance commit as sourceCommitSha", () => {
    const sha = loadSourceCommitSha(VENDOR)
    // Matches the hand-authored seeds' ARCH_REPO_COMMIT so all seeds share one
    // provenance sha for the vendored tree.
    expect(sha).toBe("634cef02")
    expect(sha).toHaveLength(8)
    for (const seed of seeds) {
      expect(seed.sourceCommitSha).toBe(sha)
    }
  })

  it("reads the identity-authority ADR faithfully", () => {
    const identity = seeds.find((s) => s.key === "0007-identity-authority")
    expect(identity).toBeDefined()
    expect(identity!.title).toBe("SovGrant is the canonical identity provider")
    expect(identity!.statement).toContain("single Identity Provider")
    expect(identity!.governs).toEqual([
      { type: "REPOSITORY", repository: "sovgrant" },
      { type: "REPOSITORY", repository: "relnex" },
      { type: "REPOSITORY", repository: "sovport" },
    ])
  })

  it("reads the UI-invariant ADR and governs the UI system repo", () => {
    const ui = seeds.find((s) => s.sourcePath === UI_INVARIANT_SOURCE_PATH)
    expect(ui).toBeDefined()
    expect(ui!.title).toBe("UI invariant and waiver process")
    expect(ui!.governs.map((g) => g.repository)).toContain("facet")
  })

  it("fails loudly when the vendored ADR directory is missing", () => {
    expect(() => loadAdrDecisions(resolve(VENDOR, "does-not-exist"))).toThrow(
      /Vendored ADR directory not found/,
    )
  })
})

describe("ECOSYSTEM_DECISIONS", () => {
  it("is the 8 ADR-derived seeds plus the 3 standard-backed seeds", () => {
    expect(ECOSYSTEM_DECISIONS).toHaveLength(11)
    const keys = ECOSYSTEM_DECISIONS.map((d: DecisionSeed) => d.key)
    expect(keys).toContain("retired-npm-scope")
    expect(keys).toContain("repo-structure-baseline")
    expect(keys).toContain("agent-protocol")
    for (const adrKey of EXPECTED_ADR_KEYS) {
      expect(keys).toContain(adrKey)
    }
  })

  it("no longer carries the retired hand-authored keys", () => {
    const keys = new Set(ECOSYSTEM_DECISIONS.map((d) => d.key))
    expect(keys.has("ui-invariant-facet")).toBe(false)
    expect(keys.has("naming-ledger")).toBe(false)
    expect(keys.has("identity-authority")).toBe(false)
  })

  it("marks every seeded decision active so none is hidden from active results", () => {
    for (const seed of ECOSYSTEM_DECISIONS) {
      expect(seed.status).toBe("active")
    }
  })

  it("resolves the default vendor dir from the repo root", () => {
    const dir = defaultVendorDir()
    expect(existsSync(dir)).toBe(true)
    expect(loadAdrDecisions()).toHaveLength(8)
  })
})
