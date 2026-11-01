import { prisma } from "@fusorb/intel-graph"
import { ECOSYSTEM_DECISIONS, type DecisionTarget } from "./decisions.js"
import { upsertDecision, linkGoverns, linkViolates } from "./graph.js"

export interface GovernanceSummary {
  decisions: number
  governsEdges: number
  violations: number
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

/** Every dependency name declared by a package across all four dependency buckets. */
function declaredDependencyNames(pkg: {
  dependencies: unknown
  devDependencies: unknown
  peerDependencies: unknown
  optionalDependencies: unknown
}): string[] {
  const names: string[] = []
  for (const bucket of [
    pkg.dependencies,
    pkg.devDependencies,
    pkg.peerDependencies,
    pkg.optionalDependencies,
  ]) {
    names.push(...Object.keys(asRecord(bucket)))
  }
  return names
}

/** Shadcn-style UI dependencies — kept identical to `scripts/verify.ts` fact 3. */
function isShadcnStyle(name: string): boolean {
  return (
    /shadcn/i.test(name) ||
    name.startsWith("@radix-ui/") ||
    name === "lucide-react" ||
    name === "clsx" ||
    name === "tailwind-merge"
  )
}

/** Repositories the UI invariant governs, derived from the seed (not hardcoded). */
function uiGovernedRepos(): Set<string> {
  const seed = ECOSYSTEM_DECISIONS.find((d) => d.key === "ui-invariant-facet")
  return new Set((seed?.governs ?? []).map((g) => g.repository))
}

async function resolveTarget(
  target: DecisionTarget,
): Promise<{ id: string; type: "REPOSITORY" | "PACKAGE" } | null> {
  if (target.type === "REPOSITORY") {
    const repo = await prisma.repository.findFirst({
      where: { name: target.repository, removedAt: null },
      select: { id: true },
    })
    return repo ? { id: repo.id, type: "REPOSITORY" } : null
  }
  if (!target.packageName) return null
  const pkg = await prisma.package.findFirst({
    where: {
      name: target.packageName,
      removedAt: null,
      repository: { name: target.repository },
    },
    select: { id: true },
  })
  return pkg ? { id: pkg.id, type: "PACKAGE" } : null
}

/**
 * Scan the live graph for entities that currently break a seeded decision and
 * (re)write VIOLATES edges. Any active VIOLATES edge into a seeded decision is
 * soft-deleted first, so violations that no longer hold are cleared — the graph
 * converges to the current commit on every run.
 */
export async function detectViolations(decisionIds: Map<string, string>): Promise<number> {
  const now = new Date()
  await prisma.relationship.updateMany({
    where: {
      kind: "VIOLATES",
      toEntityId: { in: [...decisionIds.values()] },
      removedAt: null,
    },
    data: { removedAt: now },
  })

  let count = 0
  const uiRepos = uiGovernedRepos()

  // Detectors A (retired @arcevo scope) and B (UI invariant) read package manifests.
  const packages = await prisma.package.findMany({
    where: { removedAt: null, repository: { name: { not: "npm" } } },
    select: {
      id: true,
      sourcePath: true,
      sourceCommitSha: true,
      dependencies: true,
      devDependencies: true,
      peerDependencies: true,
      optionalDependencies: true,
      repository: { select: { name: true } },
    },
  })

  for (const p of packages) {
    const names = declaredDependencyNames(p)

    const scopeDecision = decisionIds.get("retired-npm-scope")
    if (scopeDecision) {
      const arcevo = names.filter((n) => n.startsWith("@arcevo/"))
      if (arcevo.length > 0) {
        await linkViolates(
          p.id,
          "PACKAGE",
          scopeDecision,
          `depends on ${arcevo.join(", ")} (retired @arcevo scope)`,
          p.sourcePath,
          p.sourceCommitSha,
        )
        count++
      }
    }

    const uiDecision = decisionIds.get("ui-invariant-facet")
    if (uiDecision && uiRepos.has(p.repository.name)) {
      const shadcn = names.filter(isShadcnStyle)
      if (shadcn.length > 0) {
        await linkViolates(
          p.id,
          "PACKAGE",
          uiDecision,
          `UI dependencies bypass Facet: ${shadcn.join(", ")}`,
          p.sourcePath,
          p.sourceCommitSha,
        )
        count++
      }
    }
  }

  // Detector C: repo-structure baseline. Only markdown docs are ingested, so the
  // AGENTS.md/CLAUDE.md clauses are checkable; the CI-workflow clause is not.
  const structureDecision = decisionIds.get("repo-structure-baseline")
  if (structureDecision) {
    const repos = await prisma.repository.findMany({
      where: { removedAt: null, name: { not: "npm" } },
      select: { id: true, sourceCommitSha: true },
    })
    for (const r of repos) {
      const docs = await prisma.document.findMany({
        where: {
          repositoryId: r.id,
          removedAt: null,
          path: { in: ["AGENTS.md", "CLAUDE.md"] },
        },
        select: { path: true },
      })
      const present = new Set(docs.map((d) => d.path))
      const missing = ["AGENTS.md", "CLAUDE.md"].filter((path) => !present.has(path))
      if (missing.length > 0) {
        await linkViolates(
          r.id,
          "REPOSITORY",
          structureDecision,
          `missing ${missing.join(", ")}`,
          ".",
          r.sourceCommitSha,
        )
        count++
      }
    }
  }

  return count
}

/**
 * Seed the authored ecosystem Decisions, write their GOVERNS edges (clearing
 * stale ones), then detect and refresh VIOLATES edges. Idempotent: re-running
 * converges without duplicating rows or edges.
 */
export async function runGovernance(): Promise<GovernanceSummary> {
  const decisionIds = new Map<string, string>()
  for (const seed of ECOSYSTEM_DECISIONS) {
    const id = await upsertDecision({
      key: seed.key,
      title: seed.title,
      statement: seed.statement,
      status: seed.status,
      sourcePath: seed.sourcePath,
      sourceCommitSha: seed.sourceCommitSha,
    })
    decisionIds.set(seed.key, id)
  }

  // Clear stale GOVERNS edges from the seeded decisions, then re-assert from seed.
  await prisma.relationship.updateMany({
    where: {
      kind: "GOVERNS",
      fromEntityId: { in: [...decisionIds.values()] },
      removedAt: null,
    },
    data: { removedAt: new Date() },
  })

  let governsEdges = 0
  for (const seed of ECOSYSTEM_DECISIONS) {
    const decisionId = decisionIds.get(seed.key)
    if (!decisionId) continue
    for (const target of seed.governs) {
      const resolved = await resolveTarget(target)
      if (!resolved) {
        console.warn(
          `[governance] target not ingested, skipping: ${seed.key} -> ` +
            `${target.repository}${target.packageName ? `/${target.packageName}` : ""}`,
        )
        continue
      }
      await linkGoverns(
        decisionId,
        resolved.id,
        resolved.type,
        null,
        seed.sourcePath,
        seed.sourceCommitSha,
      )
      governsEdges++
    }
  }

  const violations = await detectViolations(decisionIds)
  return { decisions: decisionIds.size, governsEdges, violations }
}
