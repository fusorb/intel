import { describe, it, expect, beforeAll } from "vitest"
import {
  searchPackage,
  searchRepository,
  getDependencies,
  getPackageDependencies,
  getDecisionViolations,
  getGovernedEntities,
  traverseRelationships,
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
    return getPackageDependencies("sovgrant", "arc-id").then((pkg) => {
      expect(pkg).not.toBeNull()
      expect(pkg!.repositoryName).toBe("sovgrant")
      expect(pkg!.packageName).toBe("arc-id")
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
})

describe("traverseRelationships", () => {
  it("traverses CONSUMES edges from a package", () => {
    if (!hasDb) return
    // First find the package "arc-id" to get its database ID
    return searchPackage("arc-id").then((entities) => {
      const match = entities.find((e) => e.name === "arc-id")
      expect(match).toBeDefined()
      return traverseRelationships(match!.id, "PACKAGE" as never, ["CONSUMES" as never])
    }).then((results) => {
      expect(results.length).toBeGreaterThan(0)
      expect(results.some((r) => r.kind === "CONSUMES")).toBe(true)
    })
  })
})
