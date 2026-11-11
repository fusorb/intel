import { describe, it, expect } from "vitest"
import { createApp } from "../src/server.js"
import type { ApiConfig, ApiDeps } from "../src/types.js"

function makeDeps(overrides: Partial<ApiDeps> = {}): ApiDeps {
  return {
    retrieve: async () => ({ entities: [], relationships: [], documents: [] }),
    formatContext: () => "context block",
    searchContent: async () => ({ entities: [], relationships: [], documents: [] }),
    findSymbol: async () => [],
    findCallers: async () => ({ entities: [], relationships: [], documents: [] }),
    findReferences: async () => ({ entities: [], relationships: [], documents: [] }),
    getActiveDecisions: async () => [],
    getDecisionViolations: async () => ({ entities: [], relationships: [], documents: [] }),
    runAgent: async () => ({
      answer: "agent answer",
      citations: [],
      warnings: [],
      steps: 2,
      toolCalls: [{ tool: "find_symbol", args: {}, result: {} }],
    }),
    createProvider: () => ({
      providerName: "fake",
      modelName: "fake",
      generate: async () => ({
        text: "the answer",
        citations: [{ sourcePath: "package.json", sourceCommitSha: null }],
        warnings: [],
      }),
    }),
    pingDatabase: async () => true,
    ...overrides,
  }
}

function makeConfig(overrides: Partial<ApiConfig> = {}): ApiConfig {
  return {
    authMode: "none",
    authToken: null,
    authHeader: "cf-access-authenticated-user-email",
    corsOrigin: null,
    rateLimitMax: 60,
    rateLimitWindowMs: 60_000,
    requestTimeoutMs: 5_000,
    maxBodyBytes: 1024,
    agentMaxSteps: 5,
    ...overrides,
  }
}

const jsonPost = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
})

describe("intel-api", () => {
  it("serves /health unauthenticated with a database probe", async () => {
    const app = createApp(makeDeps(), makeConfig({ authMode: "token", authToken: "secret" }))
    const res = await app.request("/health")
    expect(res.status).toBe(200)
    const body = (await res.json()) as { status: string; database: boolean }
    expect(body.status).toBe("ok")
    expect(body.database).toBe(true)
  })

  it("reports 503 when the database is unreachable", async () => {
    const app = createApp(makeDeps({ pingDatabase: async () => false }), makeConfig())
    const res = await app.request("/health")
    expect(res.status).toBe(503)
    expect(((await res.json()) as { database: boolean }).database).toBe(false)
  })

  it("rejects requests without a bearer token in token mode", async () => {
    const app = createApp(makeDeps(), makeConfig({ authMode: "token", authToken: "secret" }))
    expect((await app.request("/decisions")).status).toBe(401)
    expect(
      (await app.request("/decisions", { headers: { Authorization: "Bearer nope" } })).status,
    ).toBe(401)
  })

  it("accepts a valid bearer token", async () => {
    const app = createApp(makeDeps(), makeConfig({ authMode: "token", authToken: "secret" }))
    const res = await app.request("/decisions", { headers: { Authorization: "Bearer secret" } })
    expect(res.status).toBe(200)
  })

  it("accepts the edge identity header in cloudflare-access mode", async () => {
    const app = createApp(makeDeps(), makeConfig({ authMode: "cloudflare-access" }))
    const res = await app.request("/decisions", {
      headers: { "cf-access-authenticated-user-email": "dev@fusorb.com" },
    })
    expect(res.status).toBe(200)
  })

  it("returns the decision status on /decisions", async () => {
    const app = createApp(
      makeDeps({
        getActiveDecisions: async () => [
          {
            entityType: "DECISION",
            id: "d1",
            name: "SovGrant is the canonical identity provider",
            path: "SovGrant is the canonical identity provider",
            description: "single Identity Provider",
            content: null,
            provenance: {
              sourcePath: "decisions/0007-identity-authority.md",
              sourceType: "file",
              sourceCommitSha: "634cef02",
              firstSeenAt: new Date(),
              retrievedAt: new Date(),
              evidenceLevel: "verified",
              removedAt: null,
            },
            score: 1.0,
            status: "proposed",
          },
        ],
      }),
      makeConfig(),
    )
    const res = await app.request("/decisions")
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      decisions: Array<{ entityType: string; status?: string }>
    }
    expect(body.decisions).toHaveLength(1)
    expect(body.decisions[0]!.entityType).toBe("DECISION")
    expect(body.decisions[0]!.status).toBe("proposed")
  })

  it("sets security headers on every response", async () => {
    const app = createApp(makeDeps(), makeConfig())
    const res = await app.request("/health")
    expect(res.headers.get("x-content-type-options")).toBe("nosniff")
    expect(res.headers.get("x-frame-options")).toBe("DENY")
    expect(res.headers.get("cache-control")).toBe("no-store")
  })

  it("answers POST /ask with citations", async () => {
    const app = createApp(makeDeps(), makeConfig())
    const res = await app.request("/ask", jsonPost({ question: "Who calls faceted?" }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { answer: string; citations: unknown[] }
    expect(body.answer).toBe("the answer")
    expect(body.citations).toHaveLength(1)
  })

  it("rejects POST /ask without a question", async () => {
    const app = createApp(makeDeps(), makeConfig())
    expect((await app.request("/ask", jsonPost({}))).status).toBe(400)
  })

  it("runs the agent loop and returns only tool names", async () => {
    const app = createApp(makeDeps(), makeConfig())
    const res = await app.request("/ask/agent", jsonPost({ question: "Find callers" }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { answer: string; steps: number; tools: string[] }
    expect(body.answer).toBe("agent answer")
    expect(body.steps).toBe(2)
    expect(body.tools).toEqual(["find_symbol"])
  })

  it("validates query parameters on /search", async () => {
    const app = createApp(makeDeps(), makeConfig())
    expect((await app.request("/search")).status).toBe(400)
    expect((await app.request("/search?q=facet")).status).toBe(200)
  })

  it("clamps the /search limit to a sane range", async () => {
    const seen: number[] = []
    const app = createApp(
      makeDeps({
        searchContent: async (_query, limit) => {
          seen.push(limit ?? -1)
          return { entities: [], relationships: [], documents: [] }
        },
      }),
      makeConfig(),
    )
    await app.request("/search?q=facet&limit=100000")
    await app.request("/search?q=facet&limit=0")
    await app.request("/search?q=facet&limit=abc")
    await app.request("/search?q=facet")
    expect(seen).toEqual([100, 1, 20, 20])
  })

  it("requires a name on /symbols", async () => {
    const app = createApp(makeDeps(), makeConfig())
    expect((await app.request("/symbols")).status).toBe(400)
    expect((await app.request("/symbols?name=useAuth")).status).toBe(200)
  })

  it("rejects a missing or malformed edge identity in cloudflare-access mode", async () => {
    const app = createApp(makeDeps(), makeConfig({ authMode: "cloudflare-access" }))
    expect((await app.request("/decisions")).status).toBe(401)
    expect(
      (
        await app.request("/decisions", {
          headers: { "cf-access-authenticated-user-email": "not-an-email" },
        })
      ).status,
    ).toBe(401)
  })

  it("returns 504 when a request exceeds the configured timeout", async () => {
    const app = createApp(
      makeDeps({ retrieve: () => new Promise<never>(() => {}) }),
      makeConfig({ requestTimeoutMs: 20 }),
    )
    const res = await app.request("/ask", jsonPost({ question: "slow" }))
    expect(res.status).toBe(504)
    expect((await res.json()) as { error: string }).toEqual({ error: "timeout" })
  })

  it("serves call-graph lookups", async () => {
    const app = createApp(
      makeDeps({
        findCallers: async () => ({
          entities: [],
          relationships: [
            {
              id: "r1",
              kind: "REFERENCES",
              fromId: "a",
              fromType: "SYMBOL",
              fromName: "caller",
              toId: "b",
              toType: "SYMBOL",
              toName: "callee",
              note: null,
              depType: null,
              provenance: {
                sourcePath: "src/a.ts",
                sourceType: "file",
                sourceCommitSha: "abc",
                firstSeenAt: new Date(),
                retrievedAt: new Date(),
                evidenceLevel: "inferred",
                removedAt: null,
              },
              score: 0.8,
            },
          ],
          documents: [],
        }),
      }),
      makeConfig(),
    )
    const res = await app.request("/symbols/b/callers")
    expect(res.status).toBe(200)
    expect(((await res.json()) as { relationships: unknown[] }).relationships).toHaveLength(1)
  })

  it("returns 404 for unknown routes", async () => {
    const app = createApp(makeDeps(), makeConfig())
    expect((await app.request("/nope")).status).toBe(404)
  })

  it("rejects oversized request bodies", async () => {
    const app = createApp(makeDeps(), makeConfig({ maxBodyBytes: 64 }))
    const res = await app.request("/ask", jsonPost({ question: "x".repeat(500) }))
    expect(res.status).toBe(413)
  })

  it("rate limits per identity", async () => {
    const app = createApp(makeDeps(), makeConfig({ rateLimitMax: 1 }))
    expect((await app.request("/decisions")).status).toBe(200)
    expect((await app.request("/decisions")).status).toBe(429)
  })
})
