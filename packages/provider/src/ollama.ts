// --- OllamaProvider: local LLM via Ollama HTTP API ---

import type {
  Answer,
  GenerateRequest,
  IntelligenceProvider,
} from "./types.js"
import { buildMessages } from "./prompt.js"
import { finalizeAnswer } from "./citations.js"

export interface OllamaProviderOptions {
  baseUrl?: string
  model: string
  timeoutMs?: number
}

interface OllamaChatResponse {
  model: string
  message?: {
    role: string
    content: string
  }
  done: boolean
}

export class OllamaProvider implements IntelligenceProvider {
  readonly providerName = "ollama"
  readonly modelName: string
  private baseUrl: string
  private timeoutMs: number

  constructor(opts: OllamaProviderOptions) {
    this.baseUrl = opts.baseUrl?.replace(/\/$/, "") ?? "http://localhost:11434"
    this.modelName = opts.model
    this.timeoutMs = opts.timeoutMs ?? 60000
  }

  async generate(request: GenerateRequest): Promise<Answer> {
    const messages = buildMessages(request)

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.modelName,
        stream: false,
        messages,
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    })

    if (!response.ok) {
      const body = await response.text().catch(() => "")
      throw new Error(
        `Ollama API error: ${response.status} ${response.statusText}` +
          (body ? `\n${body.slice(0, 500)}` : ""),
      )
    }

    const data = (await response.json()) as OllamaChatResponse
    const text = data.message?.content?.trim() ?? ""

    if (!text) {
      return {
        text: "I don't know.",
        citations: [],
        warnings: [
          "Ollama returned an empty response — the model may not exist or the server errored.",
        ],
      }
    }

    return finalizeAnswer(text, request.context)
  }

  /** Check whether the Ollama daemon is reachable. */
  static async isReachable(baseUrl: string): Promise<boolean> {
    try {
      const url = baseUrl.replace(/\/$/, "")
      const response = await fetch(`${url}/api/tags`, {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      })
      return response.ok
    } catch {
      return false
    }
  }
}
