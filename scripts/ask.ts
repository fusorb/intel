import { retrieve, formatContext } from "../packages/retrieval/src/index.ts"
import { createProvider } from "../packages/provider/src/index.ts"
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import { resolve } from "node:path"
import { runAgent } from "../packages/agent/src/index.ts"

const AGENT_DIR = resolve(process.cwd(), ".agent")
const CONTEXT_FILE = resolve(AGENT_DIR, "ask-context.txt")

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const useAgent = args.includes("--agent") || args.includes("-a")
  const question = args.find((a) => !a.startsWith("-"))

  if (!question) {
    console.error("Usage: pnpm ask \"<question>\" [--agent]")
    process.exit(1)
  }

  if (useAgent) {
    console.log("Mode: agent (multi-step tool use)")
    console.log("")
    const result = await runAgent(question)
    console.log(result.answer)
    console.log("")
    if (result.citations.length > 0) {
      console.log("--- Citations ---")
      for (const citation of result.citations) {
        const commit = citation.sourceCommitSha ?? "N/A"
        console.log(`  - sourcePath: ${citation.sourcePath} | commit: ${commit}`)
      }
      console.log("")
    }
    if (result.warnings.length > 0) {
      console.log("--- Warnings ---")
      for (const warning of result.warnings) {
        console.log(`  ! ${warning}`)
      }
      console.log("")
    }
    console.log(`--- Agent: ${result.steps} steps, ${result.toolCalls.length} tool calls ---`)
    return
  }

  // Load previous retrieval context (for follow-up questions)
  let previousContext = ""
  if (existsSync(CONTEXT_FILE)) {
    previousContext = readFileSync(CONTEXT_FILE, "utf-8")
  }

  // Step 1: Retrieve — one retrieval pass
  const result = await retrieve(question)
  const newContext = formatContext(result)

  // Combine previous + new context for follow-up questions
  const fullContext = previousContext
    ? `${previousContext}\n\n--- New Retrieval ---\n\n${newContext}`
    : newContext

  // Save the current context for the next question
  mkdirSync(AGENT_DIR, { recursive: true })
  writeFileSync(CONTEXT_FILE, newContext, "utf-8")

  // Step 2: Generate — one provider call
  const provider = createProvider()
  console.log(`Provider: ${provider.providerName}`)
  console.log(`Model: ${provider.modelName}`)
  console.log("")
  const answer = await provider.generate({ question, context: fullContext })

  // Step 3: Print — answer with citations
  console.log(answer.text)
  console.log("")

  if (answer.citations.length > 0) {
    console.log("--- Citations ---")
    for (const citation of answer.citations) {
      const commit = citation.sourceCommitSha ?? "N/A"
      console.log(`  - sourcePath: ${citation.sourcePath} | commit: ${commit}`)
    }
    console.log("")
  }

  if (answer.warnings.length > 0) {
    console.log("--- Warnings ---")
    for (const warning of answer.warnings) {
      console.log(`  ! ${warning}`)
    }
    console.log("")
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
