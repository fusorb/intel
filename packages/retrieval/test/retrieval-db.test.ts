import { describe, it, expect, beforeAll } from "vitest"
import { prisma } from "@fusorb/intel-graph"
import {
  searchPackage,
  searchRepository,
  getDependencies,
  getPackageDependencies,
  getDecisionViolations,
  getActiveDecisions,
  getGovernedEntities,
  traverseRelationships,
  findSymbol,
  findCallers,
  findReferences,
  retrieve,
} from "@fusorb/intel-retrieval"

const hasDb = Boolean(process.env.DATABASE_URL)

beforeAll(() => {
  if (!hasDb) {
    console.warn("DATABASE_URL not set — skipping database-backed tests")
  }
})

describe("searchPackage (exact match)", () => {
  it("finds an exact package by scoped name", () => {
    if (!hasDb) return
    return searchPackage("@fusorb/facet-cli").then((entities) => {
      expect(entities.length).toBeGreaterThan(0)
      const match = entities.find((e) => e.name === "@fusorb/facet-cli")
      expect(match).toBeDefined()
      expect(match!.entityType).toBe("PACKAGE")
    })
  })

  it("finds an external npm package by name", () => {
    if (!hasDb) return
    return searchPackage("react", true).then((entities) => {
      expect(entities.length).toBeGreaterThan(0)
      const match = entities.find((e) => e.name === "react")
      expect(match).toBeDefined()
      expect(match!.provenance.sourceType).toBe("inferred_pattern")
    })
  })
})

describe("searchRepository (exact match)", () => {
  it("finds SovGrant repository", () => {
    if (!hasDb) return
    return searchRepository("sovgrant").then((entities) => {
      expect(entities.length).toBeGreaterThan(0)
      const match = entities.find((e) => e.name === "sovgrant")
      expect(match).toBeDefined()
      expect(match!.entityType).toBe("REPOSITORY")
    })
  })

  it("returns empty for a non-existent repository", () => {
    if (!hasDb) return
    return searchRepository("nonexistent-repo-xyz").then((entities) => {
      expect(entities.length).toBe(0)
    })
  })
})

describe("getDependencies", () => {
  it("returns SovGrant's packages with their dependencies", () => {
    if (!hasDb) return
    return getDependencies("sovgrant").then((result) => {
      expect(result.entities.length).toBeGreaterThan(0)
      const consumesEdges = result.relationships.filter((r) => r.kind === "CONSUMES")
      expect(consumesEdges.length).toBeGreaterThan(0)
      const facetSdkDep = consumesEdges.find((r) =>
        r.toName.includes("facet"),
      )
      expect(facetSdkDep).toBeDefined()
    })
  })

  it("includes depType in dependencies", () => {
    if (!hasDb) return
    return getDependencies("sovgrant").then((result) => {
      const consumesEdges = result.relationships.filter((r) => r.kind === "CONSUMES")
      for (const edge of consumesEdges) {
        expect(edge.depType).toBeTruthy()
      }
    })
  })
})

describe("getPackageDependencies", () => {
  it("returns dependencies for a specific package", () => {
    if (!hasDb) return
    return getPackageDependencies("sovgrant", "sovgrant").then((pkg) => {
      expect(pkg).not.toBeNull()
      expect(pkg!.repositoryName).toBe("sovgrant")
      expect(pkg!.packageName).toBe("sovgrant")
      expect(pkg!.dependencies.length).toBeGreaterThan(0)
      const depWithType = pkg!.dependencies.find((d) => d.depType === "dependency")
      expect(depWithType).toBeDefined()
      const devDep = pkg!.dependencies.find((d) => d.depType === "dev")
      expect(devDep).toBeDefined()
    })
  })
})

describe("getDecisionViolations", () => {
  it("returns empty when no decisions are recorded", () => {
    if (!hasDb) return
    return getDecisionViolations().then((result) => {
      expect(result.relationships.length).toBe(0)
      expect(result.entities.length).toBe(0)
    })
  })
})

describe("getGovernedEntities", () => {
  it("returns empty for a non-existent decision", () => {
    if (!hasDb) return
    return getGovernedEntities("nonexistent-decision-id").then((result) => {
      expect(result.entities.length).toBe(0)
    })
  })

  it("resolves repository targets for seeded decisions", async () => {
    if (!hasDb) return
    const decisions = await getActiveDecisions()
    if (decisions.length === 0) return // governance not seeded in this database

    let sawRepoEdge = false
    for (const d of decisions) {
      const result = await getGovernedEntities(d.id)
      for (const rel of result.relationships) {
        if (rel.kind === "GOVERNS" && rel.toType === "REPOSITORY") {
          sawRepoEdge = true
          expect(rel.toName).toBeTruthy()
          // The governed repository must be resolved as an entity, not left as a raw id
          expect(
            result.entities.some(
              (e) => e.id === rel.toId && e.entityType === "REPOSITORY",
            ),
          ).toBe(true)
        }
      }
    }
    // The seeded UI invariant governs repositories (sovgrant, relnex)
    expect(sawRepoEdge).toBe(true)
  })
})

describe("traverseRelationships", () => {
  it("traverses CONSUMES edges from a package", () => {
    if (!hasDb) return
    // First find the package "sovgrant" to get its database ID
    return searchPackage("sovgrant").then((entities) => {
      const match = entities.find((e) => e.name === "sovgrant")
      expect(match).toBeDefined()
      return traverseRelationships(match!.id, "PACKAGE" as never, ["CONSUMES" as never])
    }).then((results) => {
      expect(results.length).toBeGreaterThan(0)
      expect(results.some((r) => r.kind === "CONSUMES")).toBe(true)
    })
  })
})

describe("findSymbol", () => {
  it("returns empty for a nonsense name", async () => {
    if (!hasDb) return
    const results = await findSymbol("zzz_nonexistent_symbol_zzz")
    expect(results).toHaveLength(0)
  })

  it("finds an ingested symbol by exact name with provenance", async () => {
    if (!hasDb) return
    const sample = await prisma.symbol.findFirst({
      where: { removedAt: null },
      select: { name: true },
    })
    if (!sample) return // no symbols ingested in this database

    const results = await findSymbol(sample.name)
    expect(results.some((e) => e.name === sample.name)).toBe(true)
    expect(results[0].entityType).toBe("SYMBOL")
    expect(results[0].provenance.sourcePath).toBeTruthy()
  })
})

describe("findCallers / findReferences", () => {
  it("returns an empty RetrievalResult for an unknown symbol id", async () => {
    if (!hasDb) return
    const callers = await findCallers("nonexistent-symbol-id")
    expect(callers.entities).toEqual([])
    expect(callers.relationships).toEqual([])

    const refs = await findReferences("nonexistent-symbol-id")
    expect(refs.entities).toEqual([])
    expect(refs.relationships).toEqual([])
  })

  it("resolves REFERENCES edges when the call graph is populated", async () => {
    if (!hasDb) return
    const edge = await prisma.relationship.findFirst({
      where: { kind: "REFERENCES", removedAt: null },
      select: { toEntityId: true },
    })
    if (!edge) return // call graph not populated yet in this database

    const callers = await findCallers(edge.toEntityId)
    expect(callers.relationships.length).toBeGreaterThan(0)
    expect(callers.relationships.every((r) => r.kind === "REFERENCES")).toBe(true)
  })
})

describe("findCallers fallback removal", () => {
  it("returns empty (no guessed siblings) for a symbol with no incoming REFERENCES", async () => {
    if (!hasDb) return
    const candidates = await prisma.symbol.findMany({
      where: { removedAt: null },
      select: { id: true, name: true },
      take: 100,
    })
    for (const s of candidates) {
      const incoming = await prisma.relationship.count({
        where: {
          toEntityId: s.id,
          toEntityType: "SYMBOL",
          kind: "REFERENCES",
          removedAt: null,
        },
      })
      if (incoming === 0) {
        const callers = await findCallers(s.id, s.name)
        expect(callers.entities).toEqual([])
        expect(callers.relationships).toEqual([])
        return
      }
    }
    // No edge-free symbol in the sample — nothing to assert.
  })
})

describe("soft-delete filtering in secondary lookups", () => {
  it("excludes a soft-deleted repository from searchRepository", async () => {
    if (!hasDb) return
    const repo = await prisma.repository.findFirst({
      where: { name: "sovport", removedAt: null },
      select: { id: true },
    })
    if (!repo) return

    await prisma.repository.update({ where: { id: repo.id }, data: { removedAt: new Date() } })
    try {
      const found = await searchRepository("sovport")
      expect(found).toEqual([])
    } finally {
      await prisma.repository.update({ where: { id: repo.id }, data: { removedAt: null } })
    }
  })
})

describe("retrieve (batched dependents)", () => {
  it("still returns CONSUMES dependents for a package-heavy question", async () => {
    if (!hasDb) return
    const result = await retrieve("facet components auth sovgrant relnex", { limit: 20 })
    expect(result.relationships.some((r) => r.kind === "CONSUMES")).toBe(true)
  })
})
