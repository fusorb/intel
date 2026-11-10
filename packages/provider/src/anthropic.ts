// --- AnthropicProvider ---

import type { Answer, GenerateRequest, IntelligenceProvider } from "./types.js"
import { Anthropic } from "@anthropic-ai/sdk"
import { SYSTEM_PROMPT, buildMessages } from "./prompt.js"
import { finalizeAnswer } from "./citations.js"

export interface AnthropicProviderOptions {
  apiKey: string
  model?: string
  timeoutMs?: number
  /** Injected client — primarily for testing. */
  client?: Anthropic
}

export class AnthropicProvider implements IntelligenceProvider {
  readonly providerName = "anthropic"
  readonly modelName: string
  private client: Anthropic

  constructor(opts: AnthropicProviderOptions) {
    this.modelName = opts.model ?? "claude-sonnet-5"
    this.client = opts.client ?? new Anthropic({ apiKey: opts.apiKey, timeout: opts.timeoutMs })
  }

  async generate(request: GenerateRequest): Promise<Answer> {
    // Honor request.messages when present (the agent loop drives the
    // conversation through them); otherwise fall back to the single-shot prompt.
    const all = buildMessages(request)
    const systemPrompt =
      all
        .filter((m) => m.role === "system")
        .map((m) => m.content)
        .join("\n\n") || SYSTEM_PROMPT
    const messages = all
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
        content: m.content,
      }))

    const response = await this.client.messages.create({
      model: this.modelName,
      max_tokens: 8192,
      system: systemPrompt,
      messages,
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

    return finalizeAnswer(text, request.context)
  }
}
