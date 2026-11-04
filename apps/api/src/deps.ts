import { prisma } from "@fusorb/intel-graph"
import {
  retrieve,
  formatContext,
  searchContent,
  findSymbol,
  findCallers,
  findReferences,
  getActiveDecisions,
  getDecisionViolations,
} from "@fusorb/intel-retrieval"
import { runAgent } from "@fusorb/intel-agent"
import { createProvider } from "@fusorb/intel-provider"
import type { ApiDeps } from "./types.js"

/** Production wiring: the real packages, plus a cheap database liveness probe. */
export const defaultDeps: ApiDeps = {
  retrieve,
  formatContext,
  searchContent,
  findSymbol,
  findCallers,
  findReferences,
  getActiveDecisions,
  getDecisionViolations,
  runAgent,
  createProvider,
  pingDatabase: async () => {
    try {
      await prisma.$queryRaw`SELECT 1`
      return true
    } catch {
      return false
    }
  },
}
