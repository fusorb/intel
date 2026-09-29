// --- OpenRouterProvider: OpenAI-compatible chat completions over OpenRouter ---

import type {
  Answer,
  GenerateRequest,
  IntelligenceProvider,
} from "./types.js"
import { buildMessages } from "./prompt.js"
import { finalizeAnswer } from "./citations.js"

export interface OpenRouterProviderOptions {
  apiKey: string
  model: string
  baseUrl?: string
  timeoutMs?: number
  httpReferer?: string
  appName?: string
}

interface OpenRouterChatResponse {
  choices?: Array<{
    message?: {
      role?: string
      content?: string
    }
  }>
  error?: {
    message: string
    type?: string
    code?: string | number
  }
}

export class OpenRouterProvider implements IntelligenceProvider {
  readonly providerName = "openrouter"
  readonly modelName: string
  private apiKey: string
  private baseUrl: string
  private timeoutMs: number
  private httpReferer: string
  private appName: string

  constructor(opts: OpenRouterProviderOptions) {
    this.apiKey = opts.apiKey
    this.modelName = opts.model
    this.baseUrl = opts.baseUrl?.replace(/\/$/, "") ?? "https://openrouter.ai/api/v1"
    this.timeoutMs = opts.timeoutMs ?? 60000
    this.httpReferer = opts.httpReferer ?? "https://fusorb.com"
    this.appName = opts.appName ?? "Fusorb Intel"
  }

  async generate(request: GenerateRequest): Promise<Answer> {
    const messages = buildMessages(request)

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": this.httpReferer,
        "X-Title": this.appName,
      },
      body: JSON.stringify({
        model: this.modelName,
        messages,
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    })

    if (!response.ok) {
      const body = await response.text().catch(() => "")
      throw new Error(
        `OpenRouter API error: ${response.status} ${response.statusText}` +
          (body ? `\n${body.slice(0, 500)}` : ""),
      )
    }

    const data = (await response.json()) as OpenRouterChatResponse

    if (data.error) {
      throw new Error(
        `OpenRouter API error: ${data.error.message}` +
          (data.error.type ? ` (${data.error.type})` : ""),
      )
    }

    const text = data.choices?.[0]?.message?.content?.trim() ?? ""

    if (!text) {
      return {
        text: "I don't know.",
        citations: [],
        warnings: [
          "OpenRouter returned an empty response — check model name and API key.",
        ],
      }
    }

    return finalizeAnswer(text, request.context)
  }
}
