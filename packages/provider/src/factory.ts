// --- Provider factory: env-driven selection with clear errors ---

import type { IntelligenceProvider } from "./types.js"
import { MockProvider } from "./mock.js"
import { AnthropicProvider } from "./anthropic.js"
import { OllamaProvider } from "./ollama.js"
import { OpenRouterProvider } from "./openrouter.js"

/** Default provider when INTEL_PROVIDER is unset. Safe — no external calls. */
export const DEFAULT_PROVIDER = "mock"

/** All valid INTEL_PROVIDER values. */
export const VALID_PROVIDERS = [
  "mock",
  "anthropic",
  "ollama",
  "openrouter",
] as const

/** Thrown when the provider config is missing or invalid. */
export class ProviderConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ProviderConfigurationError"
  }
}

/** Create a provider based on environment variables. */
export function createProvider(): IntelligenceProvider {
  const provider = (process.env.INTEL_PROVIDER || DEFAULT_PROVIDER).toLowerCase()

  switch (provider) {
    case "mock":
      return new MockProvider()

    case "anthropic": {
      const apiKey = process.env.ANTHROPIC_API_KEY
      if (!apiKey) {
        throw new ProviderConfigurationError(
          "INTEL_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set. " +
            "Set it in your .env or environment.",
        )
      }
      return new AnthropicProvider({
        apiKey,
        model: process.env.ANTHROPIC_MODEL,
        timeoutMs: process.env.ANTHROPIC_TIMEOUT_MS
          ? Number(process.env.ANTHROPIC_TIMEOUT_MS)
          : undefined,
      })
    }

    case "ollama": {
      const model = process.env.OLLAMA_MODEL
      if (!model) {
        throw new ProviderConfigurationError(
          "INTEL_PROVIDER=ollama but OLLAMA_MODEL is not set. " +
            "Set OLLAMA_MODEL in your .env (e.g. OLLAMA_MODEL=llama3.2:3b).",
        )
      }
      return new OllamaProvider({
        baseUrl: process.env.OLLAMA_BASE_URL,
        model,
        timeoutMs: process.env.OLLAMA_TIMEOUT_MS
          ? Number(process.env.OLLAMA_TIMEOUT_MS)
          : undefined,
      })
    }

    case "openrouter": {
      const apiKey = process.env.OPENROUTER_API_KEY
      if (!apiKey) {
        throw new ProviderConfigurationError(
          "INTEL_PROVIDER=openrouter but OPENROUTER_API_KEY is not set. " +
            "Set it in your .env or environment.",
        )
      }
      const model = process.env.OPENROUTER_MODEL
      if (!model) {
        throw new ProviderConfigurationError(
          "INTEL_PROVIDER=openrouter but OPENROUTER_MODEL is not set. " +
            "Set OPENROUTER_MODEL in your .env (e.g. OPENROUTER_MODEL=meta-llama/llama-70b).",
        )
      }
      return new OpenRouterProvider({
        apiKey,
        model,
        baseUrl: process.env.OPENROUTER_BASE_URL,
        timeoutMs: process.env.OPENROUTER_TIMEOUT_MS
          ? Number(process.env.OPENROUTER_TIMEOUT_MS)
          : undefined,
      })
    }

    default:
      throw new ProviderConfigurationError(
        `Unknown INTEL_PROVIDER "${provider}". ` +
          `Valid values: ${VALID_PROVIDERS.join(", ")}.`,
      )
  }
}
