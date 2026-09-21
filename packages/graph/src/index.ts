/// Prisma client wrapper for the Intel knowledge graph.
/// Re-exports the Prisma client singleton and all evidence helpers.

import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { Pool } from "pg"

// Singleton pattern — prevents connection pool exhaustion during dev reload.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function buildPool(): Pool {
  const url = process.env.DATABASE_URL
  if (!url || url.trim().length === 0) {
    throw new Error("DATABASE_URL is not set")
  }
  return new Pool({
    connectionString: url,
    max: 10,
    idleTimeoutMillis: 30000,
  })
}

function buildClient(pool: Pool): PrismaClient {
  const adapter = new PrismaPg(pool)
  return new PrismaClient({ adapter })
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? buildClient(buildPool())

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma
}

// Re-export PrismaClient and Prisma types for downstream consumers
export { PrismaClient } from "@prisma/client"
export type { Prisma } from "@prisma/client"

// Re-export evidence vocabulary so callers can import everything from @fusorb/intel-graph
export * from "@fusorb/intel-evidence"
