// --- AnthropicProvider ---

import type { Answer, GenerateRequest, IntelligenceProvider } from "./types.js"
import { Anthropic } from "@anthropic-ai/sdk"
import { SYSTEM_PROMPT } from "./prompt.js"
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
    const userMessage =
      `Question: ${request.question}\n\n` +
      `${request.context}\n\n` +
      `Answer the question using ONLY the context above. ` +
      `For every factual claim, cite the source inline as ` +
      `[source: <sourcePath>, commit: <sourceCommitSha>]. ` +
      `If you don't know, say so.`

    const response = await this.client.messages.create({
      model: this.modelName,
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

    return finalizeAnswer(text, request.context)
  }
}
