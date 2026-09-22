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

let _prisma: PrismaClient | undefined = globalForPrisma.prisma

// Lazy singleton — connects to PostgreSQL only on first property access.
// Allows importing @fusorb/intel-graph (and transitively retrieval) without
// a running database, e.g. for unit tests of pure logic.
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop: string | symbol) {
    if (prop === "then" || prop === "toJSON" || prop === Symbol.toPrimitive) {
      return undefined
    }
    if (!_prisma) {
      _prisma = globalForPrisma.prisma ?? buildClient(buildPool())
      if (process.env.NODE_ENV !== "production") {
        globalForPrisma.prisma = _prisma
      }
    }
    return _prisma[prop as keyof PrismaClient]
  },
})

// Re-export generated enum types for downstream consumers (retrieval, tools, etc.)
export { EntityType, RelationshipKind, DependencyType } from "@prisma/client"
export type { Prisma } from "@prisma/client"

// Re-export evidence vocabulary so callers can import everything from @fusorb/intel-graph
export * from "@fusorb/intel-evidence"
