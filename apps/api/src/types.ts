import type {
  RetrievalResult,
  RetrievedEntity,
  SearchOptions,
  FindSymbolOptions,
  RetrieveOptions,
} from "@fusorb/intel-retrieval"
import type { AgentOptions, AgentResult } from "@fusorb/intel-agent"
import type { IntelligenceProvider } from "@fusorb/intel-provider"

/**
 * Everything the HTTP layer needs, injected so the app can be tested without a
 * database or a live model. Production wires these to the real packages in
 * `deps.ts`; tests pass fakes.
 */
export interface ApiDeps {
  retrieve(question: string, options?: RetrieveOptions): Promise<RetrievalResult>
  formatContext(result: RetrievalResult): string
  searchContent(query: string, limit?: number, options?: SearchOptions): Promise<RetrievalResult>
  findSymbol(name: string, options?: FindSymbolOptions): Promise<RetrievedEntity[]>
  findCallers(symbolId: string, symbolName?: string): Promise<RetrievalResult>
  findReferences(symbolId: string): Promise<RetrievalResult>
  getActiveDecisions(): Promise<RetrievedEntity[]>
  getDecisionViolations(): Promise<RetrievalResult>
  runAgent(question: string, options?: AgentOptions): Promise<AgentResult>
  createProvider(): IntelligenceProvider
  /** Resolves true when the database is reachable. */
  pingDatabase(): Promise<boolean>
}

export type ApiAuthMode = "none" | "token" | "cloudflare-access"

export interface ApiConfig {
  authMode: ApiAuthMode
  /** Shared bearer token for `authMode: "token"` (single-user tool). */
  authToken: string | null
  /** Header carrying the edge identity for `authMode: "cloudflare-access"`. */
  authHeader: string
  corsOrigin: string | null
  rateLimitMax: number
  rateLimitWindowMs: number
  requestTimeoutMs: number
  maxBodyBytes: number
  agentMaxSteps: number
}
