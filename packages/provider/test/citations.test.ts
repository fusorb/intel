import { describe, it, expect } from "vitest"
import {
  extractCitations,
  checkUnsourcedClaims,
  extractSourcePathsFromContext,
  CITATION_REGEX,
  DONT_KNOW_PATTERNS,
  MockProvider,
} from "@fusorb/intel-provider"

describe("extractCitations", () => {
  it("extracts a single citation", () => {
    const text = "SovGrant depends on react [source: package.json, commit: abc12345]."
    const result = extractCitations(text)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      sourcePath: "package.json",
      sourceCommitSha: "abc12345",
    })
  })

  it("extracts multiple citations", () => {
    const text =
      "SovGrant uses react [source: package.json, commit: abc12345] and also uses next [source: package.json, commit: abc12345]."
    const result = extractCitations(text)
    expect(result).toHaveLength(2)
    expect(result[0].sourcePath).toBe("package.json")
    expect(result[0].sourceCommitSha).toBe("abc12345")
    expect(result[1].sourcePath).toBe("package.json")
    expect(result[1].sourceCommitSha).toBe("abc12345")
  })

  it("handles N/A commit SHA", () => {
    const text = "External package [source: npm:express, commit: N/A]."
    const result = extractCitations(text)
    expect(result).toHaveLength(1)
    expect(result[0].sourcePath).toBe("npm:express")
    expect(result[0].sourceCommitSha).toBeNull()
  })

  it("returns empty array for text with no citations", () => {
    const result = extractCitations("SovGrant uses react and next.")
    expect(result).toEqual([])
  })

  it("handles citations with extra whitespace", () => {
    const text = "SovGrant depends on react [source:  package.json ,  commit:  abc12345 ]."
    const result = extractCitations(text)
    expect(result[0].sourcePath).toBe("package.json")
    expect(result[0].sourceCommitSha).toBe("abc12345")
  })

  it("does not match malformed citations", () => {
    const text = "This is a [source: package.json] without commit field."
    const result = extractCitations(text)
    expect(result).toEqual([])
  })

  it("CITATION_REGEX is exported and functional", () => {
    const text = "Value [source: path/to/file, commit: deadbeef]"
    const regex = new RegExp(CITATION_REGEX.source, "g")
    const match = regex.exec(text)
    expect(match).not.toBeNull()
    expect(match![1]).toBe("path/to/file")
    expect(match![2]).toBe("deadbeef")
  })
})

describe("checkUnsourcedClaims", () => {
  it("passes when all citations are sourced in context", () => {
    const text = "SovGrant depends on react. [source: package.json, commit: abc12345]"
    const citations = extractCitations(text)
    const context = 'sourcePath="package.json", sourceCommitSha="abc12345"'
    const warnings = checkUnsourcedClaims(text, citations, context)
    expect(warnings).toHaveLength(0)
  })

  it("flags fabricated citations not in context", () => {
    const text = "SovGrant depends on react [source: package.json, commit: abc12345]."
    const citations = extractCitations(text)
    const context = 'sourcePath="other.json", sourceCommitSha="def67890"'
    const warnings = checkUnsourcedClaims(text, citations, context)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("does not appear in the retrieved context")
    expect(warnings[0]).toContain("package.json")
  })

  it("flags zero citations when claims are made", () => {
    const text = "SovGrant depends on react and also uses next for frontend rendering."
    const warnings = checkUnsourcedClaims(text, [], "sourcePath=\"package.json\"")
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("zero citations")
  })

  it("does not flag 'I don't know' responses with zero citations", () => {
    const text = "I don't know"
    const warnings = checkUnsourcedClaims(text, [], "context here")
    expect(warnings).toHaveLength(0)
  })

  it("does not flag zero citations for short text (< 50 chars)", () => {
    const text = "React is used."
    const warnings = checkUnsourcedClaims(text, [], "context")
    expect(warnings).toHaveLength(0)
  })

  it("detectes various 'I don't know' patterns", () => {
    for (const pattern of DONT_KNOW_PATTERNS) {
      const text = `The answer is: ${pattern.replace("i ", "I ")}.`
      const warnings = checkUnsourcedClaims(text, [], "context")
      // Should not flag as unsourced since it's a don't-know response
      expect(warnings).toHaveLength(0)
    }
  })
})

describe("extractSourcePathsFromContext", () => {
  it("extracts sourcePath values from context", () => {
    const context =
      'provenance: sourcePath="package.json", sourceCommitSha="abc12345"\n' +
      'provenance: sourcePath="README.md", sourceCommitSha="def67890"'
    const paths = extractSourcePathsFromContext(context)
    expect(paths.size).toBe(2)
    expect(paths.has("package.json")).toBe(true)
    expect(paths.has("README.md")).toBe(true)
  })

  it("returns empty set for context without sourcePath", () => {
    const context = "No provenance here."
    const paths = extractSourcePathsFromContext(context)
    expect(paths.size).toBe(0)
  })
})

describe("MockProvider", () => {
  it("returns 'I don't know' by default", async () => {
    const provider = new MockProvider()
    const answer = await provider.generate({
      question: "What is the meaning of life?",
      context: "sourcePath=\"README.md\"",
    })
    expect(answer.text).toBe("I don't know")
    expect(answer.citations).toEqual([])
    expect(answer.warnings).toEqual([])
  })

  it("returns canned response when set", async () => {
    const provider = new MockProvider()
    provider.setResponse(
      "SovGrant depends on react [source: package.json, commit: abc12345].",
    )
    const answer = await provider.generate({
      question: "What does SovGrant depend on?",
      context: 'sourcePath="package.json", sourceCommitSha="abc12345"',
    })
    expect(answer.text).toContain("react")
    expect(answer.citations).toHaveLength(1)
    expect(answer.citations[0].sourcePath).toBe("package.json")
  })

  it("extracts citations from canned response", async () => {
    const provider = new MockProvider()
    provider.setResponse(
      "SovGrant uses react [source: package.json, commit: abc12345] and next [source: package.json, commit: abc12345].",
    )
    const answer = await provider.generate({
      question: "deps?",
      context: 'sourcePath="package.json"',
    })
    expect(answer.citations).toHaveLength(2)
  })
})
