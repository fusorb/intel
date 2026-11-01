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
  messages?: Array<{ role: "system" | "user" | "assistant" | "tool"; content: string; tool?: string }>
  tools?: Array<any>
}

export interface IntelligenceProvider {
  readonly providerName: string
  readonly modelName: string
  generate(request: GenerateRequest): Promise<Answer>
}
