import type { ApiAuthMode, ApiConfig } from "./types.js"

function int(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function authMode(value: string | undefined): ApiAuthMode {
  if (value === "none" || value === "cloudflare-access") return value
  return "token"
}

/** Read API configuration from the environment. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  return {
    authMode: authMode(env.INTEL_API_AUTH),
    authToken: env.INTEL_API_TOKEN?.trim() || null,
    authHeader: (env.INTEL_API_AUTH_HEADER ?? "cf-access-authenticated-user-email").toLowerCase(),
    corsOrigin: env.INTEL_API_CORS_ORIGIN?.trim() || null,
    rateLimitMax: int(env.INTEL_API_RATE_LIMIT_MAX, 60),
    rateLimitWindowMs: int(env.INTEL_API_RATE_LIMIT_WINDOW_MS, 60_000),
    requestTimeoutMs: int(env.INTEL_API_TIMEOUT_MS, 120_000),
    maxBodyBytes: int(env.INTEL_API_MAX_BODY_BYTES, 16_384),
    agentMaxSteps: int(env.INTEL_API_AGENT_MAX_STEPS, 5),
  }
}
