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
      // Status is honest: ADR-derived rows are `proposed`, standard-backed rows
      // `active` — a live seed is never `superseded`/`deferred`.
      expect(["active", "proposed"]).toContain(row.status)
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

  it("prunes decisions no longer in the seed, removing their edges", async () => {
    if (!hasDb) return

    await runGovernance()

    const target = await prisma.repository.findFirst({
      where: { removedAt: null },
      select: { id: true },
    })
    const staleKey = "test-retired-decision"
    const stale = await prisma.decision.upsert({
      where: { key: staleKey },
      create: { key: staleKey, title: "Retired", statement: "retired", status: "active" },
      update: { status: "active" },
    })

    if (target) {
      // One edge with the stale decision as source and one as target, covering
      // both prune directions.
      await prisma.relationship.upsert({
        where: {
          fromEntityId_toEntityId_fromEntityType_toEntityType_kind: {
            fromEntityId: stale.id,
            toEntityId: target.id,
            fromEntityType: "DECISION",
            toEntityType: "REPOSITORY",
            kind: "GOVERNS",
          },
        },
        create: {
          fromEntityId: stale.id,
          toEntityId: target.id,
          fromEntityType: "DECISION",
          toEntityType: "REPOSITORY",
          kind: "GOVERNS",
          sourcePath: "test",
        },
        update: { removedAt: null },
      })
      await prisma.relationship.upsert({
        where: {
          fromEntityId_toEntityId_fromEntityType_toEntityType_kind: {
            fromEntityId: target.id,
            toEntityId: stale.id,
            fromEntityType: "REPOSITORY",
            toEntityType: "DECISION",
            kind: "VIOLATES",
          },
        },
        create: {
          fromEntityId: target.id,
          toEntityId: stale.id,
          fromEntityType: "REPOSITORY",
          toEntityType: "DECISION",
          kind: "VIOLATES",
          sourcePath: "test",
        },
        update: { removedAt: null },
      })
    }

    await runGovernance()

    expect(await prisma.decision.findUnique({ where: { key: staleKey } })).toBeNull()
    const staleEdges = await prisma.relationship.count({
      where: { OR: [{ fromEntityId: stale.id }, { toEntityId: stale.id }] },
    })
    expect(staleEdges).toBe(0)

    // Seeded decisions and their GOVERNS edges survive the prune.
    const seededKeys = ECOSYSTEM_DECISIONS.map((d) => d.key)
    const remaining = await prisma.decision.findMany({ where: { key: { in: seededKeys } } })
    expect(remaining.length).toBe(seededKeys.length)
    const seededGoverns = await prisma.relationship.count({
      where: {
        kind: "GOVERNS",
        removedAt: null,
        fromEntityId: { in: remaining.map((d) => d.id) },
      },
    })
    expect(seededGoverns).toBeGreaterThan(0)
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

  it("clears a violation that no longer holds", async () => {
    if (!hasDb) return

    await runGovernance()

    // `agent-protocol` has no detector, so an edge pointing at it can never be
    // re-derived: anything active after a run is a violation that survived the
    // clear pass in detectViolations().
    const repo = await prisma.repository.findFirst({
      where: { removedAt: null, name: { not: "npm" } },
      select: { id: true },
    })
    const decision = await prisma.decision.findUnique({
      where: { key: "agent-protocol" },
      select: { id: true },
    })
    expect(repo).not.toBeNull()
    expect(decision).not.toBeNull()

    const key = {
      fromEntityId: repo!.id,
      toEntityId: decision!.id,
      fromEntityType: "REPOSITORY" as const,
      toEntityType: "DECISION" as const,
      kind: "VIOLATES" as const,
    }
    const seeded = await prisma.relationship.upsert({
      where: { fromEntityId_toEntityId_fromEntityType_toEntityType_kind: key },
      create: { ...key, sourcePath: "test", note: "synthetic violation" },
      update: { sourcePath: "test", note: "synthetic violation", removedAt: null },
    })
    expect(seeded.removedAt).toBeNull()

    await runGovernance()

    const after = await prisma.relationship.findUnique({ where: { id: seeded.id } })
    expect(after?.removedAt).not.toBeNull()
    const active = await prisma.relationship.count({
      where: { ...key, removedAt: null },
    })
    expect(active).toBe(0)
  })
})
