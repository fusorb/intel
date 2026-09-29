import { describe, it, expect, vi, afterEach } from "vitest"

import {
  createProvider,
  ProviderConfigurationError,
  VALID_PROVIDERS,
  DEFAULT_PROVIDER,
  MockProvider,
  AnthropicProvider,
  OllamaProvider,
  OpenRouterProvider,
  extractCitations,
  checkUnsourcedClaims,
} from "@fusorb/intel-provider"

// --- Factory selection tests ---

describe("createProvider", () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnv }
    vi.restoreAllMocks()
  })

  it("defaults to MockProvider when INTEL_PROVIDER is unset", () => {
    delete process.env.INTEL_PROVIDER
    const provider = createProvider()
    expect(provider).toBeInstanceOf(MockProvider)
    expect(provider.providerName).toBe("mock")
  })

  it("defaults to MockProvider when INTEL_PROVIDER is empty", () => {
    process.env.INTEL_PROVIDER = ""
    const provider = createProvider()
    expect(provider).toBeInstanceOf(MockProvider)
  })

  it("selects MockProvider when INTEL_PROVIDER=mock", () => {
    process.env.INTEL_PROVIDER = "mock"
    const provider = createProvider()
    expect(provider).toBeInstanceOf(MockProvider)
    expect(provider.modelName).toBe("mock-gpt-4o")
  })

  it("selects OllamaProvider when INTEL_PROVIDER=ollama", () => {
    process.env.INTEL_PROVIDER = "ollama"
    process.env.OLLAMA_MODEL = "llama3.2:latest"
    process.env.OLLAMA_BASE_URL = "http://localhost:11434"
    const provider = createProvider()
    expect(provider).toBeInstanceOf(OllamaProvider)
    expect(provider.providerName).toBe("ollama")
    expect(provider.modelName).toBe("llama3.2:latest")
  })

  it("throws if OLLAMA_MODEL is missing for ollama provider", () => {
    process.env.INTEL_PROVIDER = "ollama"
    delete process.env.OLLAMA_MODEL
    expect(() => createProvider()).toThrow(ProviderConfigurationError)
    expect(() => createProvider()).toThrow(/OLLAMA_MODEL is not set/)
  })

  it("selects OpenRouterProvider when INTEL_PROVIDER=openrouter", () => {
    process.env.INTEL_PROVIDER = "openrouter"
    process.env.OPENROUTER_API_KEY = "sk-or-v1-test-key"
    process.env.OPENROUTER_MODEL = "meta-llama/llama-70b"
    const provider = createProvider()
    expect(provider).toBeInstanceOf(OpenRouterProvider)
    expect(provider.providerName).toBe("openrouter")
    expect(provider.modelName).toBe("meta-llama/llama-70b")
  })

  it("throws if OPENROUTER_API_KEY is missing", () => {
    process.env.INTEL_PROVIDER = "openrouter"
    process.env.OPENROUTER_MODEL = "meta-llama/llama-70b"
    delete process.env.OPENROUTER_API_KEY
    expect(() => createProvider()).toThrow(ProviderConfigurationError)
    expect(() => createProvider()).toThrow(/OPENROUTER_API_KEY is not set/)
  })

  it("throws if OPENROUTER_MODEL is missing", () => {
    process.env.INTEL_PROVIDER = "openrouter"
    process.env.OPENROUTER_API_KEY = "sk-or-v1-test-key"
    delete process.env.OPENROUTER_MODEL
    expect(() => createProvider()).toThrow(ProviderConfigurationError)
    expect(() => createProvider()).toThrow(/OPENROUTER_MODEL is not set/)
  })

  it("selects AnthropicProvider when INTEL_PROVIDER=anthropic", () => {
    process.env.INTEL_PROVIDER = "anthropic"
    process.env.ANTHROPIC_API_KEY = "sk-ant-api03-test"
    process.env.ANTHROPIC_MODEL = "claude-sonnet-5"
    const provider = createProvider()
    expect(provider).toBeInstanceOf(AnthropicProvider)
    expect(provider.providerName).toBe("anthropic")
    expect(provider.modelName).toBe("claude-sonnet-5")
  })

  it("throws if ANTHROPIC_API_KEY is missing for anthropic provider", () => {
    process.env.INTEL_PROVIDER = "anthropic"
    delete process.env.ANTHROPIC_API_KEY
    expect(() => createProvider()).toThrow(ProviderConfigurationError)
    expect(() => createProvider()).toThrow(/ANTHROPIC_API_KEY is not set/)
  })

  it("throws for an unknown provider name", () => {
    process.env.INTEL_PROVIDER = "warp-drive"
    expect(() => createProvider()).toThrow(ProviderConfigurationError)
    expect(() => createProvider()).toThrow(/Unknown INTEL_PROVIDER/)
  })

  it("exports a documented safe default", () => {
    expect(DEFAULT_PROVIDER).toBe("mock")
  })

  it("exports all valid provider values", () => {
    expect(VALID_PROVIDERS).toEqual(
      expect.arrayContaining(["mock", "anthropic", "ollama", "openrouter"]),
    )
  })

  it("does NOT silently fall back to MockProvider for a configured real provider", () => {
    process.env.INTEL_PROVIDER = "anthropic"
    delete process.env.ANTHROPIC_API_KEY
    expect(() => createProvider()).toThrow(ProviderConfigurationError)
  })
})

// --- MockProvider tests ---

describe("MockProvider", () => {
  it("returns I don't know by default", async () => {
    const provider = new MockProvider()
    const answer = await provider.generate({
      question: "What is the meaning of life?",
      context: 'sourcePath="README.md"',
    })
    expect(answer.text).toBe("I don't know")
    expect(answer.citations).toEqual([])
    expect(answer.warnings).toEqual([])
  })

  it("returns canned response when set", async () => {
    const provider = new MockProvider()
    provider.setResponse(
      "SovGrant depends on react [source: package.json, commit: abc12345].",
    )
    const answer = await provider.generate({
      question: "What does SovGrant depend on?",
      context: 'sourcePath="package.json", sourceCommitSha="abc12345"',
    })
    expect(answer.text).toContain("react")
    expect(answer.citations).toHaveLength(1)
    expect(answer.citations[0]?.sourcePath).toBe("package.json")
  })

  it("extracts citations from canned response", async () => {
    const provider = new MockProvider()
    provider.setResponse(
      "SovGrant uses react [source: package.json, commit: abc12345] and next [source: package.json, commit: abc12345].",
    )
    const answer = await provider.generate({
      question: "deps?",
      context: 'sourcePath="package.json"',
    })
    expect(answer.citations).toHaveLength(2)
  })
})

// --- OllamaProvider tests (mocked fetch) ---

describe("OllamaProvider", () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it("sends a POST to the Ollama chat endpoint with model and stream:false", async () => {
    const mockFetch = vi.fn()
    globalThis.fetch = mockFetch as unknown as typeof fetch

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        model: "llama3.2:latest",
        message: { role: "assistant", content: "Answer text" },
        done: true,
      }),
    })

    const provider = new OllamaProvider({
      model: "llama3.2:latest",
      baseUrl: "http://localhost:11434",
    })
    await provider.generate({ question: "test?", context: "" })

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:11434/api/chat",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    )

    // Verify model and stream are in the serialized body
    const callArg = mockFetch.mock.calls[0]?.[1] as { body: string } | undefined
    const body = callArg?.body ?? ""
    expect(body).toContain('"model":"llama3.2:latest"')
    expect(body).toContain('"stream":false')
  })

  it("extracts text and citations from the Ollama response", async () => {
    const mockFetch = vi.fn()
    globalThis.fetch = mockFetch as unknown as typeof fetch

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        model: "llama3.2:latest",
        message: {
          role: "assistant",
          content: "SovGrant is a project [source: src/index.ts, commit: abc123].",
        },
        done: true,
      }),
    })

    const provider = new OllamaProvider({ model: "llama3.2:latest" })
    const answer = await provider.generate({
      question: "What is SovGrant?",
      context: 'sourcePath="src/index.ts"',
    })

    expect(answer.text).toContain("SovGrant is a project")
    expect(answer.citations).toHaveLength(1)
    expect(answer.citations[0]?.sourcePath).toBe("src/index.ts")
  })

  it("flags empty response with a warning", async () => {
    const mockFetch = vi.fn()
    globalThis.fetch = mockFetch as unknown as typeof fetch

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        model: "llama3.2:latest",
        message: { role: "assistant", content: "" },
        done: true,
      }),
    })

    const provider = new OllamaProvider({ model: "llama3.2:latest" })
    const answer = await provider.generate({ question: "x?", context: "" })

    expect(answer.text).toBe("I don't know.")
    expect(answer.warnings).toContain(
      "Ollama returned an empty response — the model may not exist or the server errored.",
    )
  })

  it("throws on HTTP error with status code", async () => {
    const mockFetch = vi.fn()
    globalThis.fetch = mockFetch as unknown as typeof fetch

    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      text: async () => "model not found",
    })

    const provider = new OllamaProvider({ model: "nonexistent" })
    await expect(provider.generate({ question: "x?", context: "" })).rejects.toThrow(
      /Ollama API error: 404/,
    )
  })
})

// --- OpenRouterProvider tests (mocked fetch) ---

describe("OpenRouterProvider", () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it("sends request to OpenRouter chat-completions endpoint with auth", async () => {
    const mockFetch = vi.fn()
    globalThis.fetch = mockFetch as unknown as typeof fetch

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { role: "assistant", content: "Hello" } }],
      }),
    })

    const provider = new OpenRouterProvider({
      apiKey: "sk-or-v1-test",
      model: "meta-llama/llama-70b",
    })
    await provider.generate({ question: "hi?", context: "" })

    expect(mockFetch).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer sk-or-v1-test",
          "Content-Type": "application/json",
          "X-Title": "Fusorb Intel",
        }),
      }),
    )
  })

  it("extracts text and citations from response", async () => {
    const mockFetch = vi.fn()
    globalThis.fetch = mockFetch as unknown as typeof fetch

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              role: "assistant",
              content: "SovGrant uses React [source: package.json, commit: abc12345].",
            },
          },
        ],
      }),
    })

    const provider = new OpenRouterProvider({
      apiKey: "sk-or-v1-test",
      model: "meta-llama/llama-70b",
    })
    const answer = await provider.generate({
      question: "What does SovGrant use?",
      context: 'sourcePath="package.json"',
    })

    expect(answer.text).toContain("React")
    expect(answer.citations).toHaveLength(1)
  })

  it("handles HTTP error response", async () => {
    const mockFetch = vi.fn()
    globalThis.fetch = mockFetch as unknown as typeof fetch

    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => '{"error": {"message": "Invalid API key"}}',
    })

    const provider = new OpenRouterProvider({
      apiKey: "bad-key",
      model: "meta-llama/llama-70b",
    })
    await expect(provider.generate({ question: "x?", context: "" })).rejects.toThrow(
      /OpenRouter API error: 401/,
    )
  })

  it("handles error field in successful response body", async () => {
    const mockFetch = vi.fn()
    globalThis.fetch = mockFetch as unknown as typeof fetch

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        error: { message: "Insufficient credits", type: "insufficient_quota" },
      }),
    })

    const provider = new OpenRouterProvider({
      apiKey: "sk-or-v1-test",
      model: "meta-llama/llama-70b",
    })
    await expect(provider.generate({ question: "x?", context: "" })).rejects.toThrow(
      /OpenRouter API error: Insufficient credits/,
    )
  })
})

// --- AnthropicProvider tests (using dependency-injected mock client) ---

describe("AnthropicProvider", () => {
  function mockClient(content: Array<{ type: string; text?: string }>) {
    return {
      messages: {
        create: vi.fn().mockResolvedValue({ content }),
      },
    } as unknown as ConstructorParameters<typeof AnthropicProvider>[0]["client"]
  }

  it("uses providerName anthropic and configured model", () => {
    const provider = new AnthropicProvider({
      apiKey: "sk-ant-test",
      model: "claude-sonnet-5",
    })
    expect(provider.providerName).toBe("anthropic")
    expect(provider.modelName).toBe("claude-sonnet-5")
  })

  it("defaults model to claude-sonnet-5 when not specified", () => {
    const provider = new AnthropicProvider({ apiKey: "sk-ant-test" })
    expect(provider.modelName).toBe("claude-sonnet-5")
  })

  it("calls messages.create with correct params (max_tokens, system, messages)", async () => {
    const client = mockClient([{ type: "text", text: "OK" }])

    const provider = new AnthropicProvider({
      apiKey: "sk-ant-test",
      model: "claude-sonnet-5-20241022",
      client,
    })
    await provider.generate({ question: "x?", context: "" })

    expect(client.messages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-sonnet-5-20241022",
        max_tokens: 8192,
        system: expect.any(String),
        messages: [{ role: "user", content: expect.any(String) }],
      }),
    )
  })

  it("extracts citations from the generated text", async () => {
    const client = mockClient([
      { type: "text", text: "SovGrant depends on React [source: package.json, commit: abc12345]." },
    ])

    const provider = new AnthropicProvider({
      apiKey: "sk-ant-test",
      client: client as any,
    })
    const answer = await provider.generate({
      question: "What does SovGrant use?",
      context: 'sourcePath="package.json"',
    })

    expect(answer.citations).toHaveLength(1)
    expect(answer.citations[0]?.sourcePath).toBe("package.json")
    expect(answer.citations[0]?.sourceCommitSha).toBe("abc12345")
  })

  it("returns empty text when response has no text blocks", async () => {
    const client = mockClient([])

    const provider = new AnthropicProvider({
      apiKey: "sk-ant-test",
      client: client as any,
    })
    const answer = await provider.generate({ question: "x?", context: "" })
    expect(answer.text).toBe("")
  })

  it("preserves system prompt containing knowledge graph instructions", async () => {
    const client = mockClient([])

    const provider = new AnthropicProvider({
      apiKey: "sk-ant-test",
      client: client as any,
    })
    await provider.generate({ question: "x?", context: "" })

    const callArg = (client.messages.create as any).mock.calls[0]?.[0] as {
      system: string
    }
    expect(callArg.system).toContain("knowledge graph")
    expect(callArg.system).toContain("citation")
  })
})

// --- Citation / evidence discipline regression tests ---

describe("Citation regression (shared utilities)", () => {
  it("extractCitations still handles N/A commit SHA", () => {
    const text = "External package [source: npm:express, commit: N/A]."
    const result = extractCitations(text)
    expect(result).toHaveLength(1)
    expect(result[0]?.sourceCommitSha).toBeNull()
  })

  it("checkUnsourcedClaims still flags zero-citation claims", () => {
    const text =
      "SovGrant depends on react and also uses next for frontend rendering."
    const warnings = checkUnsourcedClaims(text, [], 'sourcePath="package.json"')
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("zero citations")
  })

  it("checkUnsourcedClaims flags fabricated citations not in context", () => {
    const text = "Claim [source: fake.ts, commit: abc123]."
    const citations = extractCitations(text)
    const warnings = checkUnsourcedClaims(text, citations, 'sourcePath="real.ts"')
    expect(warnings.some((w) => w.includes("fabricated"))).toBe(true)
  })

  it("checkUnsourcedClaims does not flag I don't know responses", () => {
    const text = "I don't know"
    const warnings = checkUnsourcedClaims(text, [], "context")
    expect(warnings).toEqual([])
  })
})
