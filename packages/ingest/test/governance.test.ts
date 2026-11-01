import { describe, it, expect, beforeAll } from "vitest"
import { prisma } from "@fusorb/intel-graph"
import { runGovernance, ECOSYSTEM_DECISIONS } from "@fusorb/intel-ingest"

const hasDb = Boolean(process.env.DATABASE_URL)

beforeAll(() => {
  if (!hasDb) {
    console.warn("DATABASE_URL not set — skipping governance tests")
  }
})

describe("runGovernance", () => {
  it("seeds decisions and GOVERNS edges, idempotently", async () => {
    if (!hasDb) return

    const first = await runGovernance()
    expect(first.decisions).toBe(ECOSYSTEM_DECISIONS.length)

    const second = await runGovernance()
    expect(second.decisions).toBe(first.decisions)
    expect(second.governsEdges).toBe(first.governsEdges)

    const seededKeys = ECOSYSTEM_DECISIONS.map((d) => d.key)
    const rows = await prisma.decision.findMany({ where: { key: { in: seededKeys } } })
    expect(rows.length).toBe(seededKeys.length)
    for (const row of rows) {
      expect(row.status).toBe("active")
      expect(row.sourceType).toBe("human_statement")
    }

    const governs = await prisma.relationship.findMany({
      where: { kind: "GOVERNS", removedAt: null },
    })
    expect(governs.length).toBeGreaterThan(0)
    for (const g of governs) {
      expect(g.fromEntityType).toBe("DECISION")
      expect(["REPOSITORY", "PACKAGE", "MODULE"]).toContain(g.toEntityType)
    }
  })

  it("points every VIOLATES edge at a seeded decision", async () => {
    if (!hasDb) return

    await runGovernance()
    const decisionIds = new Set(
      (await prisma.decision.findMany({ select: { id: true } })).map((d) => d.id),
    )
    const violates = await prisma.relationship.findMany({
      where: { kind: "VIOLATES", removedAt: null },
    })
    for (const v of violates) {
      expect(v.toEntityType).toBe("DECISION")
      expect(decisionIds.has(v.toEntityId)).toBe(true)
      expect(["REPOSITORY", "PACKAGE", "MODULE"]).toContain(v.fromEntityType)
    }
  })
})
