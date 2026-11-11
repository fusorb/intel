import { describe, it, expect, beforeAll } from "vitest"
import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { prisma } from "@fusorb/intel-graph"
import { ingestRepo } from "@fusorb/intel-ingest"
import { AGENT_REPOS } from "@fusorb/intel-ingest"

const hasDb = Boolean(process.env.DATABASE_URL)

beforeAll(() => {
  if (!hasDb) {
    console.warn("DATABASE_URL not set — skipping ingest finalize tests")
  }
})

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "intel-test",
  GIT_AUTHOR_EMAIL: "intel-test@example.invalid",
  GIT_COMMITTER_NAME: "intel-test",
  GIT_COMMITTER_EMAIL: "intel-test@example.invalid",
}

/** Create a throwaway git repo (with a valid package.json) and return its path + name. */
function makeFixtureRepo(files: Record<string, string>): { dir: string; url: string; name: string } {
  const dir = mkdtempSync(join(tmpdir(), "intel-ingest-"))
  execFileSync("git", ["init", "-q"], { cwd: dir })
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel)
    mkdirSync(join(abs, ".."), { recursive: true })
    writeFileSync(abs, content)
  }
  execFileSync("git", ["-C", dir, "add", "-A"], { env: GIT_ENV })
  execFileSync("git", ["-C", dir, "commit", "-q", "-m", "init"], { env: GIT_ENV })
  const name = dir.split(/[\\/]/).pop()!
  return { dir, url: dir.replace(/\\/g, "/"), name }
}

/** Remove every row and scratch clone created for a fixture repo. */
async function cleanupRepo(name: string): Promise<void> {
  const repo = await prisma.repository.findUnique({ where: { name }, select: { id: true } })
  if (repo) {
    const [pkgs, syms] = await Promise.all([
      prisma.package.findMany({ where: { repositoryId: repo.id }, select: { id: true } }),
      prisma.symbol.findMany({ where: { repositoryId: repo.id }, select: { id: true } }),
    ])
    const ids = [...pkgs.map((p) => p.id), ...syms.map((s) => s.id)]
    await prisma.relationship.deleteMany({
      where: {
        OR: [
          { fromEntityId: repo.id },
          { toEntityId: repo.id },
          { fromEntityId: { in: ids } },
          { toEntityId: { in: ids } },
        ],
      },
    })
    // Relationship rows are polymorphic (no FK); the rest cascade from Repository.
    await prisma.repository.delete({ where: { id: repo.id } })
  }
  rmSync(join(AGENT_REPOS, name), { recursive: true, force: true })
}

describe("ingestRepo finalizes the IngestionRun", () => {
  it("records a success run (with completedAt) after a normal ingest", async () => {
    if (!hasDb) return
    const { dir, url, name } = makeFixtureRepo({
      "package.json": JSON.stringify({ name: "intel-ingest-fixture", version: "0.0.1" }),
      "src/index.ts": "export function hello(): string {\n  return 'hi'\n}\n",
    })

    try {
      const summary = await ingestRepo(url, null)
      expect(summary.packages).toBeGreaterThanOrEqual(1)

      const run = await prisma.ingestionRun.findFirst({
        where: { repository: { name } },
        orderBy: { startedAt: "desc" },
      })
      expect(run?.status).toBe("success")
      expect(run?.completedAt).not.toBeNull()
    } finally {
      await cleanupRepo(name)
      rmSync(dir, { recursive: true, force: true })
    }
  }, 180_000)

  it("records a failed run (with completedAt) when extraction is empty", async () => {
    if (!hasDb) return
    const { dir, url, name } = makeFixtureRepo({ "notes.txt": "no package.json here\n" })

    try {
      await expect(ingestRepo(url, null)).rejects.toThrow(/refusing to mark/)

      const run = await prisma.ingestionRun.findFirst({
        where: { repository: { name } },
        orderBy: { startedAt: "desc" },
      })
      // The run must never be left stuck on "running".
      expect(run?.status).toBe("failed")
      expect(run?.completedAt).not.toBeNull()
      expect(run?.errorsJson ?? "").toContain("refusing to mark")
    } finally {
      await cleanupRepo(name)
      rmSync(dir, { recursive: true, force: true })
    }
  }, 180_000)
})
