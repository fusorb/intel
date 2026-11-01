import { createProvider } from "@fusorb/intel-provider"
import { getToolDefinitions, executeTool } from "@fusorb/intel-tools"
import { buildAgentPrompt } from "./prompts.js"

export interface AgentOptions {
  maxSteps?: number
  provider?: any
}

export interface AgentResult {
  answer: string
  citations: Array<{ sourcePath: string; sourceCommitSha: string | null }>
  warnings: string[]
  steps: number
  toolCalls: Array<{ tool: string; args: any; result: any }>
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
  const toolCalls: Array<{ tool: string; args: any; result: any }> = []
  const messages: Array<{ role: "system" | "user" | "assistant" | "tool"; content: string; tool?: string }> = [
    { role: "system", content: systemPrompt },
    { role: "user", content: `Question: ${question}` },
  ]

  for (let step = 0; step < maxSteps; step++) {
    const response = await provider.generate({
      question,
      context: "",
      messages,
    })

    const text = response.text.trim()
    
    // Try to parse as JSON
    let parsed: any
    try {
      // Extract JSON from response (in case there's extra text)
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0])
      } else {
        parsed = JSON.parse(text)
      }
    } catch {
      // If not JSON, treat as answer
      return {
        answer: response.text,
        citations: response.citations,
        warnings: response.warnings,
        steps: step + 1,
        toolCalls,
      }
    }

    if (parsed.action === "answer") {
      return {
        answer: parsed.answer || response.text,
        citations: response.citations,
        warnings: response.warnings,
        steps: step + 1,
        toolCalls,
      }
    } else if (parsed.action === "tool_call" && parsed.tool) {
      try {
        const result = await executeTool(parsed.tool, parsed.args || {})
        toolCalls.push({ tool: parsed.tool, args: parsed.args || {}, result })
        
        // Format tool result for the model
        const resultStr = JSON.stringify(result, null, 2)
        messages.push({ role: "assistant", content: text })
        messages.push({ role: "tool", content: `Tool ${parsed.tool} result:\n${resultStr}`, tool: parsed.tool })
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        messages.push({ role: "assistant", content: text })
        messages.push({ role: "tool", content: `Tool ${parsed.tool} error: ${errMsg}`, tool: parsed.tool })
      }
    } else {
      // Unknown action, treat as answer
      return {
        answer: response.text,
        citations: response.citations,
        warnings: response.warnings,
        steps: step + 1,
        toolCalls,
      }
    }
  }

  // Max steps reached, ask for final answer
  messages.push({ role: "user", content: "Based on all tool results above, provide your final answer with citations." })
  const finalResponse = await provider.generate({
    question,
    context: "",
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
