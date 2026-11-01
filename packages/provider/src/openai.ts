// --- OpenAIProvider: generic OpenAI-compatible chat completions ---
//
// Works with any OpenAI-compatible endpoint by pointing OPENAI_BASE_URL at it:
// Groq, Cerebras, Mistral, Google Gemini (OpenAI-compat path), GitHub Models,
// Cloudflare Workers AI, Hugging Face Inference Providers, NVIDIA NIM, and
// local servers such as LM Studio, llama.cpp (llama-server), vLLM, KoboldCpp,
// or Ollama's own /v1 endpoint. apiKey is optional — local servers typically
// accept any value or none at all.

import type {
  Answer,
  GenerateRequest,
  IntelligenceProvider,
} from "./types.js"
import { buildMessages } from "./prompt.js"
import { finalizeAnswer } from "./citations.js"

export interface OpenAIProviderOptions {
  /** Bearer token. Optional — local OpenAI-compatible servers need none. */
  apiKey?: string
  model: string
  baseUrl?: string
  timeoutMs?: number
}

interface OpenAIChatResponse {
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

export class OpenAIProvider implements IntelligenceProvider {
  readonly providerName = "openai"
  readonly modelName: string
  private apiKey: string
  private baseUrl: string
  private timeoutMs: number

  constructor(opts: OpenAIProviderOptions) {
    this.apiKey = opts.apiKey ?? ""
    this.modelName = opts.model
    this.baseUrl = opts.baseUrl?.replace(/\/$/, "") ?? "https://api.openai.com/v1"
    this.timeoutMs = opts.timeoutMs ?? 60000
  }

  async generate(request: GenerateRequest): Promise<Answer> {
    const messages = buildMessages(request)

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    }
    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: this.modelName,
        messages,
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    })

    if (!response.ok) {
      const body = await response.text().catch(() => "")
      throw new Error(
        `OpenAI-compatible API error: ${response.status} ${response.statusText}` +
          (body ? `\n${body.slice(0, 500)}` : ""),
      )
    }

    const data = (await response.json()) as OpenAIChatResponse

    if (data.error) {
      throw new Error(
        `OpenAI-compatible API error: ${data.error.message}` +
          (data.error.type ? ` (${data.error.type})` : ""),
      )
    }

    const text = data.choices?.[0]?.message?.content?.trim() ?? ""

    if (!text) {
      return {
        text: "I don't know.",
        citations: [],
        warnings: [
          "OpenAI-compatible API returned an empty response — check model name and API key.",
        ],
      }
    }

    return finalizeAnswer(text, request.context)
  }
}
