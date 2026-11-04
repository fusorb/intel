import { timingSafeEqual } from "node:crypto"
import type { ApiConfig } from "./types.js"

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

/**
 * Resolve the caller's identity, or null when unauthenticated.
 *
 * - `token` — single-user shared bearer token (the default for this internal tool).
 * - `cloudflare-access` — the identity header injected by Cloudflare Access.
 * - `none` — development only; every caller is "dev".
 */
export function authenticate(req: Request, config: ApiConfig): string | null {
  if (config.authMode === "none") return "dev"

  if (config.authMode === "token") {
    if (!config.authToken) return null
    const header = req.headers.get("authorization") ?? ""
    const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7) : ""
    return safeEqual(token, config.authToken) ? "architect" : null
  }

  const email = req.headers.get(config.authHeader)
  if (!email || !email.includes("@")) return null
  return email
}
