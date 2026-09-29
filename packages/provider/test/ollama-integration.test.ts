/**
 * Optional integration test for OllamaProvider.
 *
 * Only runs when INTEL_INTEGRATION_TEST=true is set in the environment.
 * This makes a real HTTP call to the local Ollama daemon and a real model.
 */
import { describe, it, expect } from "vitest"
import { OllamaProvider } from "@fusorb/intel-provider"

const RUN_INTEGRATION = process.env.INTEL_INTEGRATION_TEST === "true"
const describeIntegration = RUN_INTEGRATION ? describe : describe.skip

describeIntegration("OllamaProvider integration", () => {
  it("connects to local Ollama and generates an answer", async () => {
    const model = process.env.OLLAMA_MODEL ?? "llama3.2:latest"
    const baseUrl = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434"

    // Verify the daemon is reachable before testing
    const reachable = await OllamaProvider.isReachable(baseUrl)
    if (!reachable) {
      // eslint-disable-next-line no-throw-literal
      throw new Error(
        `Ollama daemon not reachable at ${baseUrl}. Start it with: ollama serve`,
      )
    }

    const provider = new OllamaProvider({ model, baseUrl })
    const answer = await provider.generate({
      question: "What is 2 + 2?",
      context: "",
    })

    expect(answer.text.trim().length).toBeGreaterThan(0)
  }, 30000)

  it("can answer a question about SovGrant when context is provided", async () => {
    const model = process.env.OLLAMA_MODEL ?? "llama3.2:latest"
    const baseUrl = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434"

    const provider = new OllamaProvider({ model, baseUrl })
    const answer = await provider.generate({
      question: "What is SovGrant?",
      context:
        'Provenance: sourcePath="README.md", sourceCommitSha="abc12345"\n' +
        'SovGrant is a Fusorb product that manages software bills of materials.',
    })

    expect(answer.text).toContain("SovGrant")
  }, 30000)
})
