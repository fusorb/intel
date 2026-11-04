import { Hono } from "hono"
import type { Context } from "hono"
import { RateLimiter } from "./rateLimit.js"
import { authenticate } from "./auth.js"
import type { ApiConfig, ApiDeps } from "./types.js"

type HttpStatus = 400 | 401 | 404 | 413 | 429 | 500

class HttpError extends Error {
  constructor(
    readonly status: HttpStatus,
    readonly code: string,
  ) {
    super(code)
  }
}

async function readJson(c: Context, maxBytes: number): Promise<Record<string, unknown>> {
  const declared = Number(c.req.header("content-length") ?? "0")
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new HttpError(413, "payload_too_large")
  }
  const text = await c.req.text()
  if (Buffer.byteLength(text, "utf-8") > maxBytes) throw new HttpError(413, "payload_too_large")
  if (text.trim() === "") return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new HttpError(400, "invalid_json")
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HttpError(400, "invalid_body")
  }
  return parsed as Record<string, unknown>
}

function requireQuestion(body: Record<string, unknown>): string {
  const q = body.question
  if (typeof q !== "string" || q.trim().length === 0) {
    throw new HttpError(400, "question_required")
  }
  return q.trim()
}

/**
 * Build the read-only Intel API. The only exposed surface is these routes —
 * callers never reach SQL and cannot invoke an arbitrary tool.
 */
export function createApp(deps: ApiDeps, config: ApiConfig): Hono {
  const app = new Hono()
  const limiter = new RateLimiter(config.rateLimitMax, config.rateLimitWindowMs)

  // Security headers + CORS on every response.
  app.use("*", async (c, next) => {
    c.header("X-Content-Type-Options", "nosniff")
    c.header("X-Frame-Options", "DENY")
    c.header("Referrer-Policy", "no-referrer")
    c.header("Cache-Control", "no-store")
    if (config.corsOrigin && c.req.header("origin") === config.corsOrigin) {
      c.header("Access-Control-Allow-Origin", config.corsOrigin)
      c.header("Vary", "Origin")
    }
    if (c.req.method === "OPTIONS") {
      c.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
      c.header("Access-Control-Allow-Headers", "Content-Type, Authorization")
      return c.body(null, 204)
    }
    await next()
  })

  // Health is unauthenticated so the platform can probe the origin directly.
  app.get("/health", async (c) => {
    const db = await deps.pingDatabase()
    return c.json({ status: db ? "ok" : "degraded", database: db }, db ? 200 : 503)
  })

  // Auth + rate limiting for everything else.
  app.use("*", async (c, next) => {
    if (c.req.path === "/health") return next()
    const identity = authenticate(c.req.raw, config)
    if (!identity) return c.json({ error: "unauthorized" }, 401)
    if (!limiter.allow(identity)) return c.json({ error: "rate_limited" }, 429)
    await next()
  })

  app.post("/ask", async (c) => {
    const body = await readJson(c, config.maxBodyBytes)
    const question = requireQuestion(body)
    const result = await deps.retrieve(question)
    const context = deps.formatContext(result)
    const provider = deps.createProvider()
    const answer = await provider.generate({ question, context })
    return c.json({ answer: answer.text, citations: answer.citations, warnings: answer.warnings })
  })

  app.post("/ask/agent", async (c) => {
    const body = await readJson(c, config.maxBodyBytes)
    const question = requireQuestion(body)
    const result = await deps.runAgent(question, { maxSteps: config.agentMaxSteps })
    return c.json({
      answer: result.answer,
      citations: result.citations,
      warnings: result.warnings,
      steps: result.steps,
      tools: result.toolCalls.map((t) => t.tool),
    })
  })

  app.get("/search", async (c) => {
    const q = c.req.query("q")?.trim()
    if (!q) throw new HttpError(400, "q_required")
    const limit = Number(c.req.query("limit") ?? "20")
    const result = await deps.searchContent(q, Number.isFinite(limit) ? limit : 20, {
      repositoryName: c.req.query("repo"),
    })
    return c.json(result)
  })

  app.get("/symbols", async (c) => {
    const name = c.req.query("name")?.trim()
    if (!name) throw new HttpError(400, "name_required")
    const entities = await deps.findSymbol(name, {
      repositoryName: c.req.query("repo"),
      kind: c.req.query("kind"),
    })
    return c.json({ symbols: entities })
  })

  app.get("/symbols/:id/callers", async (c) => c.json(await deps.findCallers(c.req.param("id"))))
  app.get("/symbols/:id/references", async (c) => c.json(await deps.findReferences(c.req.param("id"))))

  app.get("/decisions", async (c) => c.json({ decisions: await deps.getActiveDecisions() }))
  app.get("/violations", async (c) => c.json(await deps.getDecisionViolations()))

  app.notFound((c) => c.json({ error: "not_found" }, 404))

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.code }, err.status)
    // Never echo internal error detail to the client.
    return c.json({ error: "internal_error" }, 500)
  })

  return app
}
