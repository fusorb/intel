import { describe, it, expect } from "vitest"
import {
  extractKeywords,
  formatContext,
  type RetrievalResult,
  type RetrievedEntity,
  type ProvenanceInfo,
} from "@fusorb/intel-retrieval"

describe("extractKeywords", () => {
  it("extracts scoped package names", () => {
    const keywords = extractKeywords("Does SovGrant depend on @arcevo/facet-sdk?")
    expect(keywords).toContain("@arcevo/facet-sdk")
    expect(keywords).toContain("sovgrant")
    expect(keywords).toContain("depend")
  })

  it("preserves 'facet' as a keyword (not in stop words)", () => {
    const keywords = extractKeywords("Which repositories use Facet?")
    expect(keywords).toContain("facet")
  })

  it("preserves 'fact' as a keyword (not in stop words)", () => {
    const keywords = extractKeywords("When was that fact last confirmed?")
    expect(keywords).toContain("fact")
    expect(keywords).toContain("confirmed")
    // "confirmed" was in the old stop words — verify it's now preserved
  })

  it("filters out stop words", () => {
    const keywords = extractKeywords("What is the meaning of life?")
    expect(keywords).not.toContain("the")
    expect(keywords).not.toContain("of")
    expect(keywords).toContain("meaning")
    expect(keywords).toContain("life")
  })

  it("deduplicates keywords", () => {
    const keywords = extractKeywords("facet facet facet")
    expect(keywords.filter((k) => k === "facet")).toHaveLength(1)
  })

  it("filters out short words (length <= 2)", () => {
    const keywords = extractKeywords("Is Facet a UI system?")
    const shortWords = keywords.filter((k) => k.length <= 2)
    expect(shortWords).toHaveLength(0)
  })

  it("handles empty string", () => {
    const keywords = extractKeywords("")
    expect(keywords).toEqual([])
  })
})

describe("formatContext", () => {
  function makeResult(
    overrides: Partial<RetrievalResult> = {},
  ): RetrievalResult {
    return {
      entities: [],
      relationships: [],
      documents: [],
      ...overrides,
    }
  }

  function makeEntity(
    overrides: Partial<RetrievedEntity>,
  ): RetrievedEntity {
    return {
      entityType: "PACKAGE",
      id: "pkg1",
      name: "test-pkg",
      path: "package.json",
      description: "A test package",
      content: null,
      provenance: {
        sourcePath: "package.json",
        sourceType: "file",
        sourceCommitSha: "abc12345",
        firstSeenAt: new Date("2024-01-01T00:00:00Z"),
        retrievedAt: new Date("2024-06-01T00:00:00Z"),
        evidenceLevel: "verified",
        removedAt: null,
      },
      score: 0.9,
      ...overrides,
    }
  }

  it("includes provenance with sourcePath in context output", () => {
    const result = makeResult({ entities: [makeEntity()] })
    const context = formatContext(result)
    expect(context).toContain('sourcePath="package.json"')
    expect(context).toContain('sourceCommitSha="abc12345"')
    expect(context).toContain('firstSeenAt=')
    expect(context).toContain('retrievedAt=')
    expect(context).toContain('evidenceLevel="verified"')
  })

  it("includes depType for relationships", () => {
    const result = makeResult({
      relationships: [
        {
          id: "rel1",
          kind: "CONSUMES",
          fromId: "a",
          fromType: "PACKAGE",
          fromName: "pkg-a",
          toId: "b",
          toType: "PACKAGE",
          toName: "pkg-b",
          note: "^1.0.0",
          depType: "dev",
          provenance: {
            sourcePath: "package.json",
            sourceType: "file",
            sourceCommitSha: "abc12345",
            firstSeenAt: new Date("2024-01-01"),
            retrievedAt: new Date("2024-06-01"),
            evidenceLevel: "verified",
            removedAt: null,
          },
          score: 0.8,
        },
      ],
    })
    const context = formatContext(result)
    expect(context).toContain("depType: dev")
    expect(context).toContain("range: ^1.0.0")
  })

  it("marks external npm packages in context", () => {
    const result = makeResult({
      entities: [
        makeEntity({
          name: "express",
          provenance: {
            sourcePath: "npm:express",
            sourceType: "inferred_pattern",
            sourceCommitSha: null,
            firstSeenAt: new Date("2024-01-01"),
            retrievedAt: new Date("2024-06-01"),
            evidenceLevel: "inferred",
            removedAt: null,
          },
        }),
      ],
    })
    const context = formatContext(result)
    expect(context).toContain("npm (external)")
  })

  it("includes document content with truncation notice", () => {
    const longContent = "x".repeat(5000)
    const result = makeResult({
      documents: [
        {
          path: "README.md",
          repositoryName: "sovgrant",
          content: longContent,
          provenance: {
            sourcePath: "README.md",
            sourceType: "file",
            sourceCommitSha: "abc12345",
            firstSeenAt: new Date("2024-01-01"),
            retrievedAt: new Date("2024-06-01"),
            evidenceLevel: "verified",
            removedAt: null,
          },
          score: 0.9,
        },
      ],
    })
    const context = formatContext(result)
    expect(context).toContain("content truncated")
    expect(context).toContain("5000 chars")
  })
})
