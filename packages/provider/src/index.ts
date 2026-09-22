import Anthropic from "@anthropic-ai/sdk"

// --- Types ---

export interface Citation {
  sourcePath: string
  sourceCommitSha: string | null
}

export interface Answer {
  text: string
  citations: Citation[]
  warnings: string[]
}

export interface GenerateRequest {
  question: string
  context: string
}

export interface IntelligenceProvider {
  generate(request: GenerateRequest): Promise<Answer>
}

// --- Constants ---

const SYSTEM_PROMPT = `You are Intel, a knowledge graph assistant for the Fusorb ecosystem. You answer questions using ONLY the context provided from a graph database of repositories, packages, modules, documents, and decisions.

Instructions:
- Answer using ONLY the context provided below. Do not use prior knowledge or make assumptions.
- For every factual claim, cite the source inline as [source: <sourcePath>, commit: <sourceCommitSha>].
- If the context does not contain enough information to answer, say "I don't know" rather than guessing.
- cite sourcePath and sourceCommitSha from each fact's provenance. If a commit SHA is not available, cite "N/A".`

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

// --- Citation extraction ---

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

// --- Unsourced-claim check ---

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

// --- Provider implementations ---

export class AnthropicProvider implements IntelligenceProvider {
  private client: Anthropic
  private model: string

  constructor(apiKey: string, model?: string) {
    this.client = new Anthropic({ apiKey })
    this.model = model ?? "claude-sonnet-5"
  }

  async generate(request: GenerateRequest): Promise<Answer> {
    const userMessage =
      `Question: ${request.question}\n\n` +
      `${request.context}\n\n` +
      `Answer the question using ONLY the context above. ` +
      `For every factual claim, cite the source inline as ` +
      `[source: <sourcePath>, commit: <sourceCommitSha>]. ` +
      `If you don't know, say so.`

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    })

    const text = (response.content as Array<{ type: string; text?: string }>)
      .map((block) => {
        if (block.type === "text" && typeof block.text === "string") {
          return block.text
        }
        return ""
      })
      .filter((s) => s.length > 0)
      .join("\n")
      .trim()

    const citations = extractCitations(text)
    const warnings = checkUnsourcedClaims(text, citations, request.context)

    return { text, citations, warnings }
  }
}

/**
 * A no-cost provider for development and testing that never makes an
 * API call. Returns a canned response (or "I don't know" by default).
 */
export class MockProvider implements IntelligenceProvider {
  private cannedText: string | null = null

  /** Set a canned response the next call to generate() will return. */
  setResponse(text: string): void {
    this.cannedText = text
  }

  async generate(request: GenerateRequest): Promise<Answer> {
    const text = this.cannedText ?? "I don't know"

    const citations = extractCitations(text)
    const warnings = checkUnsourcedClaims(text, citations, request.context)

    return { text, citations, warnings }
  }
}

export function createProvider(): IntelligenceProvider {
  const apiKey = process.env.ANTHROPIC_API_KEY
  const model = process.env.ANTHROPIC_MODEL
  if (!apiKey) {
    return new MockProvider()
  }
  return new AnthropicProvider(apiKey, model)
}
