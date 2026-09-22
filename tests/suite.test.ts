import { describe, it, expect, beforeAll } from "vitest"
import { prisma } from "@fusorb/intel-graph"
import {
  getDependencies,
  getDecisionViolations,
  getActiveDecisions,
  extractKeywords,
  retrieve,
} from "@fusorb/intel-retrieval"

const hasDb = Boolean(process.env.DATABASE_URL)

beforeAll(() => {
  if (!hasDb) {
    console.warn("DATABASE_URL not set — skipping acceptance suite")
  }
})

const skipIfNoDb = hasDb ? it : it.skip

/**
 * Acceptance suite — deterministic questions from the FUSORB ecosystem.
 * The majority do NOT require an LLM.
 */
describe("Acceptance Suite", () => {
  // 1. What repositories does Intel currently know?
  skipIfNoDb("Q1: lists known repositories (no LLM)", async () => {
    const repos = await prisma.repository.findMany({
      where: { removedAt: null },
      select: { name: true },
    })
    const names = repos.map((r) => r.name).sort()
    expect(names).toContain("facet")
    expect(names).toContain("sovgrant")
    expect(names).toContain("relnex")
    expect(names).toContain("sovport")
    expect(names).toContain("npm")
  })

  // 2. What does SovGrant depend on?
  skipIfNoDb("Q2: SovGrant has dependencies with depType (no LLM)", async () => {
    const result = await getDependencies("sovgrant")
    const consumes = result.relationships.filter((r) => r.kind === "CONSUMES")
    expect(consumes.length).toBeGreaterThan(0)
    // At least one should be a facet package
    const facetDep = consumes.find((r) =>
      r.toName?.includes("facet") || r.toName?.includes("Facet"),
    )
    expect(facetDep).toBeDefined()
    // depType must be populated
    for (const edge of consumes) {
      expect(edge.depType).toBeTruthy()
    }
  })

  // 3. Which repositories use Facet?
  skipIfNoDb("Q3: find repositories that depend on Facet packages (no LLM)", async () => {
    const facetPackages = await prisma.package.findMany({
      where: {
        name: { contains: "facet", mode: "insensitive" },
        removedAt: null,
      },
      select: { id: true, repository: { select: { name: true } } },
    })
    expect(facetPackages.length).toBeGreaterThan(0)
    const facetRepoNames = [...new Set(facetPackages.map((p) => p.repository.name))]

    const facetPackageIds = facetPackages.map((p) => p.id)
    const consumers = await prisma.relationship.findMany({
      where: {
        kind: "CONSUMES",
        toEntityId: { in: facetPackageIds },
        removedAt: null,
      },
    })
    // At least one repo should depend on a Facet package
    expect(consumers.length).toBeGreaterThan(0)
    // At least one consumer repo should be a real repo (not just "npm")
    const consumerRepos = await prisma.package.findMany({
      where: {
        id: {
          in: consumers
            .filter((c) => c.fromEntityType === "PACKAGE")
            .map((c) => c.fromEntityId),
        },
      },
      select: { repository: { select: { name: true } } },
    })
    const realConsumerNames = [
      ...new Set(consumerRepos.map((p) => p.repository.name)),
    ].filter((n) => n !== "npm")
    expect(realConsumerNames.length).toBeGreaterThan(0)
  })

  // 4. Does Relnex currently depend on Facet?
  skipIfNoDb("Q4: Relnex-Facet dependency check (no LLM)", async () => {
    const result = await getDependencies("relnex")
    const facetDep = result.relationships.find(
      (r) => r.kind === "CONSUMES" && r.toName?.toLowerCase().includes("facet"),
    )
    expect(facetDep).toBeDefined()
  })

  // 5. What architectural decisions are currently represented?
  skipIfNoDb("Q5: decisions are queryable (no LLM)", async () => {
    const decisions = await getActiveDecisions()
    // Currently no decisions have been authored — should return empty
    expect(Array.isArray(decisions)).toBe(true)
    expect(decisions.length).toBe(0)
  })

  // 6. Which entities violate active decisions?
  skipIfNoDb("Q6: violations are queryable (no LLM)", async () => {
    const result = await getDecisionViolations()
    expect(result.entities.length).toBe(0)
    expect(result.relationships.length).toBe(0)
  })

  // 7. Where was a particular dependency observed?
  skipIfNoDb("Q7: dependency provenance has sourcePath (no LLM)", async () => {
    const result = await getDependencies("sovgrant")
    const consumes = result.relationships.filter((r) => r.kind === "CONSUMES")
    for (const edge of consumes) {
      expect(edge.provenance.sourcePath).toBeTruthy()
      expect(edge.provenance.sourceCommitSha).toBeTruthy()
    }
  })

  // 8. When was that fact last confirmed?
  skipIfNoDb("Q8: provenance has retrievedAt/timestamp (no LLM)", async () => {
    const result = await getDependencies("sovgrant")
    const consumes = result.relationships.filter((r) => r.kind === "CONSUMES")
    const firstEdge = consumes[0]
    expect(firstEdge).toBeDefined()
    expect(firstEdge.provenance.retrievedAt).toBeDefined()
  })

  // 9. What changed between two ingested commits?
  skipIfNoDb("Q9: ingestion-run history allows change detection (no LLM)", async () => {
    const runs = await prisma.ingestionRun.findMany({
      where: { repository: { name: "sovgrant" } },
      orderBy: { startedAt: "desc" },
      select: { commitSha: true, startedAt: true, completedAt: true, status: true },
    })
    expect(runs.length).toBeGreaterThan(0)
    // Each run should have a commit SHA
    for (const run of runs) {
      expect(run.commitSha).toBeTruthy()
      expect(run.status).toMatch(/^(running|success|failed)$/)
    }
  })

  // 10. Can Intel correctly answer "I don't know" when evidence is absent?
  skipIfNoDb("Q10: retrieve returns empty for nonsense query (no LLM)", async () => {
    const result = await retrieve(
      "flibbertigibbet xylophone zoonooby quixotic",
      { limit: 5 },
    )
    // Nonsense keywords should yield zero matches
    expect(result.entities.length).toBe(0)
    expect(result.relationships.length).toBe(0)
  })

  // --- Keyword extraction tests ---

  it("extractKeywords removes stop words but preserves meaningful terms", () => {
    const kw = extractKeywords("When was that fact last confirmed?")
    expect(kw).toContain("fact")
    expect(kw).toContain("confirmed")
    expect(kw).not.toContain("when")
    expect(kw).not.toContain("was")
    expect(kw).not.toContain("that")
    expect(kw).not.toContain("last") // "last" is a temporal modifier, not a domain term
  })
})
