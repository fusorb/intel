import { createProvider } from "@fusorb/intel-provider"
import type { IntelligenceProvider } from "@fusorb/intel-provider"
import { getToolDefinitions, executeTool } from "@fusorb/intel-tools"
import { buildAgentPrompt } from "./prompts.js"

/** Cap the serialized size of a single tool result fed back to the model. */
const MAX_TOOL_RESULT_CHARS = 20_000

interface AgentAction {
  action?: string
  answer?: string
  tool?: string
  args?: Record<string, unknown>
}

export interface AgentOptions {
  maxSteps?: number
  provider?: IntelligenceProvider
}

export interface AgentResult {
  answer: string
  citations: Array<{ sourcePath: string; sourceCommitSha: string | null }>
  warnings: string[]
  steps: number
  toolCalls: Array<{ tool: string; args: Record<string, unknown>; result: unknown }>
}

export async function runAgent(question: string, options: AgentOptions = {}): Promise<AgentResult> {
  const maxSteps = options.maxSteps ?? 5
  const provider = options.provider ?? createProvider()
  const tools = getToolDefinitions()

  const toolsDescription = tools
    .map((t) => {
      const params = t.parameters.map((p) => `    - ${p.name} (${p.type}${p.required ? ", required" : ""}): ${p.description}`).join("\n")
      return `- ${t.name}: ${t.description}\n${params}`
    })
    .join("\n\n")

  const systemPrompt = buildAgentPrompt(toolsDescription)
  const toolCalls: Array<{ tool: string; args: Record<string, unknown>; result: unknown }> = []
  const messages: Array<{ role: "system" | "user" | "assistant" | "tool"; content: string; tool?: string }> = [
    { role: "system", content: systemPrompt },
    { role: "user", content: `Question: ${question}` },
  ]

  // Evidence accumulates every tool result so the provider's citation check can
  // verify the model's citations against what was actually retrieved. Without
  // this the check runs against an empty context and flags every real citation.
  const evidence: string[] = []
  const contextNow = (): string => evidence.join("\n\n")

  for (let step = 0; step < maxSteps; step++) {
    const response = await provider.generate({
      question,
      context: contextNow(),
      messages,
    })

    const text = response.text.trim()

    let parsed: AgentAction | null = null
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text) as AgentAction
    } catch {
      parsed = null
    }

    if (parsed && parsed.action === "tool_call" && typeof parsed.tool === "string") {
      const args = parsed.args ?? {}
      try {
        const result = await executeTool(parsed.tool, args)
        toolCalls.push({ tool: parsed.tool, args, result })

        const serialized = JSON.stringify(result, null, 2)
        const bounded =
          serialized.length > MAX_TOOL_RESULT_CHARS
            ? `${serialized.slice(0, MAX_TOOL_RESULT_CHARS)}\n… [truncated]`
            : serialized
        evidence.push(`Tool ${parsed.tool} result:\n${bounded}`)

        messages.push({ role: "assistant", content: text })
        messages.push({ role: "tool", content: `Tool ${parsed.tool} result:\n${bounded}`, tool: parsed.tool })
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        messages.push({ role: "assistant", content: text })
        messages.push({ role: "tool", content: `Tool ${parsed.tool} error: ${errMsg}`, tool: parsed.tool })
      }
      continue
    }

    if (parsed && parsed.action === "answer" && typeof parsed.answer === "string") {
      return {
        answer: parsed.answer,
        citations: response.citations,
        warnings: response.warnings,
        steps: step + 1,
        toolCalls,
      }
    }

    // Not a recognizable action — treat the raw text as the final answer.
    return {
      answer: response.text,
      citations: response.citations,
      warnings: response.warnings,
      steps: step + 1,
      toolCalls,
    }
  }

  // Max steps reached, ask for a final answer using the accumulated evidence.
  messages.push({ role: "user", content: "Based on all tool results above, provide your final answer with citations." })
  const finalResponse = await provider.generate({
    question,
    context: contextNow(),
    messages,
  })

  return {
    answer: finalResponse.text,
    citations: finalResponse.citations,
    warnings: finalResponse.warnings,
    steps: maxSteps,
    toolCalls,
  }
}
