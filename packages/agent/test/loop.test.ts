import { describe, it, expect } from "vitest"
import { runAgent } from "@fusorb/intel-agent"
import { registerTool } from "@fusorb/intel-tools"

// A test-only tool so the loop can be exercised without touching the database.
registerTool({
  name: "test_agent_echo",
  description: "echo a value (test only)",
  parameters: [{ name: "value", type: "string", description: "value", required: true }],
  handler: async (args) => ({ echoed: args.value }),
})

interface StubAnswer {
  text: string
  citations: Array<{ sourcePath: string; sourceCommitSha: string | null }>
  warnings: string[]
}

/** A provider that returns a scripted sequence of answers. */
function scriptedProvider(responses: StubAnswer[]) {
  let i = 0
  return {
    providerName: "scripted",
    modelName: "scripted",
    async generate() {
      const r = responses[Math.min(i, responses.length - 1)]
      i++
      return r
    },
  }
}

const answer = (action: object): StubAnswer => ({
  text: JSON.stringify(action),
  citations: [],
  warnings: [],
})

describe("runAgent", () => {
  it("returns a direct answer with zero tool calls", async () => {
    const provider = scriptedProvider([answer({ action: "answer", answer: "Hello" })])
    const result = await runAgent("q", { provider })

    expect(result.answer).toBe("Hello")
    expect(result.toolCalls).toHaveLength(0)
    expect(result.steps).toBe(1)
  })

  it("executes a tool call, feeds the result back, then answers", async () => {
    const provider = scriptedProvider([
      answer({ action: "tool_call", tool: "test_agent_echo", args: { value: "hi" } }),
      answer({ action: "answer", answer: "Done" }),
    ])
    const result = await runAgent("q", { provider })

    expect(result.toolCalls).toHaveLength(1)
    expect(result.toolCalls[0].tool).toBe("test_agent_echo")
    expect(result.toolCalls[0].result).toEqual({ echoed: "hi" })
    expect(result.answer).toBe("Done")
    expect(result.steps).toBe(2)
  })

  it("treats non-JSON output as a plain answer", async () => {
    const provider = scriptedProvider([
      { text: "just prose", citations: [], warnings: [] },
    ])
    const result = await runAgent("q", { provider })

    expect(result.answer).toBe("just prose")
    expect(result.toolCalls).toHaveLength(0)
  })

  it("recovers from a failed tool call and still answers", async () => {
    const provider = scriptedProvider([
      answer({ action: "tool_call", tool: "does_not_exist", args: {} }),
      answer({ action: "answer", answer: "Recovered" }),
    ])
    const result = await runAgent("q", { provider })

    expect(result.answer).toBe("Recovered")
  })

  it("stops at maxSteps and asks for a final answer", async () => {
    // Always requests a tool; the loop must terminate and ask for a final answer.
    const provider = scriptedProvider([
      answer({ action: "tool_call", tool: "test_agent_echo", args: { value: "loop" } }),
    ])
    const result = await runAgent("q", { provider, maxSteps: 2 })

    expect(result.steps).toBe(2)
    expect(result.toolCalls).toHaveLength(2)
  })
})
