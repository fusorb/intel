// --- Barrel: re-export all provider surface area ---

// Types
export type { Answer, Citation, GenerateRequest, IntelligenceProvider } from "./types.js"

// Citation / evidence utilities
export {
  CITATION_REGEX,
  DONT_KNOW_PATTERNS,
  extractCitations,
  extractSourcePathsFromContext,
  checkUnsourcedClaims,
  finalizeAnswer,
} from "./citations.js"

// System prompt & message construction
export { SYSTEM_PROMPT, buildMessages } from "./prompt.js"

// Providers
export { MockProvider } from "./mock.js"
export { AnthropicProvider } from "./anthropic.js"
export type { AnthropicProviderOptions } from "./anthropic.js"
export { OllamaProvider } from "./ollama.js"
export type { OllamaProviderOptions } from "./ollama.js"
export { OpenRouterProvider } from "./openrouter.js"
export type { OpenRouterProviderOptions } from "./openrouter.js"

// Factory
export {
  createProvider,
  ProviderConfigurationError,
  DEFAULT_PROVIDER,
  VALID_PROVIDERS,
} from "./factory.js"
