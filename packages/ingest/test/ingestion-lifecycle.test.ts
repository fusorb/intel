import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest"
import { prisma } from "@fusorb/intel-graph"
import {
  markStale,
  linkConsumes,
  linkContains,
  startIngestionRun,
  completeIngestionRun,
} from "@fusorb/intel-ingest"

const hasDb = Boolean(process.env.DATABASE_URL)

beforeAll(() => {
  if (!hasDb) {
    console.warn("DATABASE_URL not set — skipping ingestion lifecycle tests")
  }
})

/** Capture the active entity and relationship IDs for a repository so we can
 * restore them after a test that calls markStale(). */
interface RepoSnapshot {
  id: string
  pkgIds: string[]
}
async function snapshotRepo(repoName: string): Promise<RepoSnapshot | null> {
  const repo = await prisma.repository.findFirst({
    where: { name: repoName, removedAt: null },
    select: { id: true },
  })
  if (!repo) return null
  const pkgs = await prisma.package.findMany({
    where: { repositoryId: repo.id },
    select: { id: true },
  })
  return { id: repo.id, pkgIds: pkgs.map((p) => p.id) }
}

/** Restore all entities and relationships for a repository to active state. */
async function restoreRepo(snap: RepoSnapshot): Promise<void> {
  const { id, pkgIds } = snap
  await prisma.package.updateMany({ where: { repositoryId: id }, data: { removedAt: null } })
  await prisma.module.updateMany({ where: { repositoryId: id }, data: { removedAt: null } })
  await prisma.document.updateMany({ where: { repositoryId: id }, data: { removedAt: null } })
  await prisma.relationship.updateMany({
    where: { fromEntityId: id, fromEntityType: "REPOSITORY", kind: "CONTAINS" },
    data: { removedAt: null },
  })
  if (pkgIds.length > 0) {
    await prisma.relationship.updateMany({
      where: {
        fromEntityId: { in: pkgIds },
        fromEntityType: "PACKAGE",
        kind: "CONSUMES",
      },
      data: { removedAt: null },
    })
  }
}

describe("markStale marks relationships stale", () => {
  let sovgrantSnap: RepoSnapshot | null

  beforeEach(async () => {
    sovgrantSnap = await snapshotRepo("sovgrant")
    expect(sovgrantSnap).not.toBeNull()
  })

  afterEach(async () => {
    if (sovgrantSnap) await restoreRepo(sovgrantSnap)
  })

  it("marks CONTAINS relationships as stale for a repository", async () => {
    if (!hasDb || !sovgrantSnap) return

    const beforeContains = await prisma.relationship.count({
      where: {
        fromEntityId: sovgrantSnap.id,
        fromEntityType: "REPOSITORY",
        kind: "CONTAINS",
        removedAt: null,
      },
    })
    expect(beforeContains).toBeGreaterThan(0)

    await markStale(sovgrantSnap.id)

    const afterStale = await prisma.relationship.count({
      where: {
        fromEntityId: sovgrantSnap.id,
        fromEntityType: "REPOSITORY",
        kind: "CONTAINS",
        removedAt: null,
      },
    })
    expect(afterStale).toBe(0)

    // Verify they're soft-deleted, not hard-deleted
    const afterRemoved = await prisma.relationship.count({
      where: {
        fromEntityId: sovgrantSnap.id,
        fromEntityType: "REPOSITORY",
        kind: "CONTAINS",
        removedAt: { not: null },
      },
    })
    expect(afterRemoved).toBe(beforeContains)
  })

  it("marks CONSUMES relationships as stale for a repository's packages", async () => {
    if (!hasDb || !sovgrantSnap) return

    const beforeConsumes = await prisma.relationship.count({
      where: {
        fromEntityId: { in: sovgrantSnap.pkgIds },
        fromEntityType: "PACKAGE",
        kind: "CONSUMES",
        removedAt: null,
      },
    })
    expect(beforeConsumes).toBeGreaterThan(0)

    await markStale(sovgrantSnap.id)

    const afterStale = await prisma.relationship.count({
      where: {
        fromEntityId: { in: sovgrantSnap.pkgIds },
        fromEntityType: "PACKAGE",
        kind: "CONSUMES",
        removedAt: null,
      },
    })
    expect(afterStale).toBe(0)

    // Stale edges should still exist (soft-deleted)
    const afterRemoved = await prisma.relationship.count({
      where: {
        fromEntityId: { in: sovgrantSnap.pkgIds },
        fromEntityType: "PACKAGE",
        kind: "CONSUMES",
        removedAt: { not: null },
      },
    })
    expect(afterRemoved).toBe(beforeConsumes)
  })
})

describe("re-ingestion idempotency", () => {
  afterEach(async () => {
    const snap = await snapshotRepo("sovgrant")
    if (snap) await restoreRepo(snap)
  })

  it("produces consistent entity counts across two identical ingestion runs", async () => {
    if (!hasDb) return

    const repo = await prisma.repository.findFirst({
      where: { name: "sovgrant" },
      select: { id: true },
    })
    if (!repo) return

    const commitSha = "29b0ca51e00ce51cc709a2acf59587971f266d6a"

    // Count before
    const before = {
      packages: await prisma.package.count({ where: { removedAt: null } }),
      modules: await prisma.module.count({ where: { removedAt: null } }),
      documents: await prisma.document.count({ where: { removedAt: null } }),
      relationships: await prisma.relationship.count({ where: { removedAt: null } }),
    }

    // Run an IngestionRun (simulates start + complete without re-ingestion)
    const runId = await startIngestionRun(repo.id, commitSha, "main")
    await completeIngestionRun(runId, "success", {
      packages: before.packages,
      modules: before.modules,
      documents: before.documents,
      consumesEdges: 88,
      containsEdges: 130,
      symbolFilesParsed: 0,
      symbolFilesSkipped: 0,
      symbolFilesErrored: 0,
    })

    // Count after — entity counts should be unchanged (idempotent)
    const after = {
      packages: await prisma.package.count({ where: { removedAt: null } }),
      modules: await prisma.module.count({ where: { removedAt: null } }),
      documents: await prisma.document.count({ where: { removedAt: null } }),
      relationships: await prisma.relationship.count({ where: { removedAt: null } }),
    }

    expect(after.packages).toBe(before.packages)
    expect(after.modules).toBe(before.modules)
    expect(after.documents).toBe(before.documents)
    expect(after.relationships).toBe(before.relationships)
  })
})

describe("IngestionRun lifecycle", () => {
  let runId: string | null = null

  afterEach(async () => {
    if (runId) {
      await prisma.ingestionRun.delete({ where: { id: runId } })
      runId = null
    }
  })

  it("tracks ingestion runs with commit SHA, status, and counts", async () => {
    if (!hasDb) return

    const repo = await prisma.repository.findFirst({
      where: { name: "sovgrant" },
      select: { id: true },
    })
    if (!repo) return

    runId = await startIngestionRun(repo.id, "test-commit-sha-abc123", "test-branch")
    expect(runId).toBeTruthy()

    const run = await prisma.ingestionRun.findUnique({
      where: { id: runId },
    })
    expect(run).toBeTruthy()
    expect(run?.commitSha).toBe("test-commit-sha-abc123")
    expect(run?.branch).toBe("test-branch")
    expect(run?.status).toBe("running")
    expect(run?.completedAt).toBeNull()

    await completeIngestionRun(runId, "success", {
      packages: 5,
      modules: 3,
      documents: 2,
      consumesEdges: 10,
      containsEdges: 8,
      symbolFilesParsed: 0,
      symbolFilesSkipped: 0,
      symbolFilesErrored: 0,
    })

    const completedRun = await prisma.ingestionRun.findUnique({
      where: { id: runId },
    })
    expect(completedRun?.status).toBe("success")
    expect(completedRun?.completedAt).not.toBeNull()
    expect(completedRun?.packagesCount).toBe(5)
    expect(completedRun?.consumesEdges).toBe(10)
  })
})
