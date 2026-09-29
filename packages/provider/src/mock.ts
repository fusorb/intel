// --- MockProvider: deterministic, no external dependencies ---

import type { Answer, GenerateRequest, IntelligenceProvider } from "./types.js"
import { extractCitations, checkUnsourcedClaims } from "./citations.js"

export class MockProvider implements IntelligenceProvider {
  readonly providerName = "mock"
  readonly modelName = "mock-gpt-4o"

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
