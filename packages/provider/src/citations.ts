// --- Citation extraction & validation utilities ---

import type { Answer, Citation } from "./types.js"

export const CITATION_REGEX = /\[source:\s*(.+?),\s*commit:\s*(.+?)\]/g

export const DONT_KNOW_PATTERNS = [
  "i don't know",
  "don't know",
  "cannot answer",
  "can't answer",
  "insufficient context",
  "no information in",
  "not enough information",
  "i cannot determine",
  "i can't determine",
  "unable to determine",
  "cannot be determined",
]

export function extractCitations(text: string): Citation[] {
  const citations: Citation[] = []
  const regex = new RegExp(CITATION_REGEX.source, "g")
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    const sourcePath = match[1]?.trim()
    const commitSha = match[2]?.trim()
    if (sourcePath && commitSha !== undefined) {
      citations.push({
        sourcePath,
        sourceCommitSha: commitSha !== "N/A" ? commitSha : null,
      })
    }
  }

  return citations
}

/** Extract every sourcePath="..." value from a formatted context string. */
export function extractSourcePathsFromContext(context: string): Set<string> {
  const paths = new Set<string>()
  const regex = /sourcePath="([^"]+)"/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(context)) !== null) {
    const path = match[1]
    if (path) paths.add(path)
  }
  return paths
}

/**
 * Post-generation heuristic: flag answers that make factual claims
 * without any inline citations, and catch fabricated citations by
 * cross-referencing each extracted citation's sourcePath against the
 * provenance actually present in the retrieved context.
 *
 * Two independent failure modes, reported with distinct warnings:
 * 1. Zero citations — the answer makes claims but cites nothing.
 * 2. Fabricated citations — the answer cites a sourcePath that does not
 *    appear in any provenance line in the context.
 */
export function checkUnsourcedClaims(
  text: string,
  citations: Citation[],
  context: string,
): string[] {
  const warnings: string[] = []

  if (citations.length === 0) {
    const lower = text.toLowerCase().trim()
    const isDontKnow = DONT_KNOW_PATTERNS.some((p) => lower.includes(p))

    if (!isDontKnow && text.trim().length > 50) {
      warnings.push(
        "Answer contains factual claims but has zero citations. " +
          "The evidence discipline may not be working — verify against the graph.",
      )
    }
  }

  const contextSourcePaths = extractSourcePathsFromContext(context)
  for (const citation of citations) {
    if (!contextSourcePaths.has(citation.sourcePath)) {
      warnings.push(
        `Citation sourcePath "${citation.sourcePath}" does not appear in the ` +
          "retrieved context — this citation may be fabricated.",
      )
    }
  }

  return warnings
}

/**
 * Shared post-processing for all providers: extract citations from the
 * generated text and run the unsourced-claim validation. Ensures every
 * provider applies the same evidence-discipline checks.
 */
export function finalizeAnswer(text: string, context: string): Answer {
  const citations = extractCitations(text)
  const warnings = checkUnsourcedClaims(text, citations, context)
  return { text, citations, warnings }
}
