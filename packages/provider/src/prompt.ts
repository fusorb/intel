// --- System prompt & message construction ---

import type { GenerateRequest } from "./types.js"

export const SYSTEM_PROMPT = `You are Intel, a knowledge graph assistant for the Fusorb ecosystem. You answer questions using ONLY the context provided from a graph database of repositories, packages, modules, documents, and decisions.

Instructions:
- Answer using ONLY the context provided below. Do not use prior knowledge or make assumptions.
- For every factual claim, provide an inline citation: [source: <sourcePath>, commit: <sourceCommitSha>].
- If the context does not contain enough information to answer, say "I don't know" rather than guessing.
- cite sourcePath and sourceCommitSha from each fact's provenance. If a commit SHA is not available, cite "N/A".`

/**
 * Build the messages array sent to any chat-completions API.
 * Providers that support system+user roles can reuse this directly.
 */
export function buildMessages(request: GenerateRequest): Array<{
  role: "system" | "user" | "assistant" | "tool"
  content: string
  tool?: string
}> {
  // If custom messages are provided, use them (for agent loop)
  if (request.messages && request.messages.length > 0) {
    return request.messages
  }

  const userMessage =
    `Question: ${request.question}\n\n` +
    `${request.context}\n\n` +
    `Answer the question using ONLY the context above. ` +
    `For every factual claim, cite the source inline as ` +
    `[source: <sourcePath>, commit: <sourceCommitSha>]. ` +
    `If you don't know, say so.`

  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userMessage },
  ]
}
