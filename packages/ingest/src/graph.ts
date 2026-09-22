import { prisma } from "@fusorb/intel-graph"
import { createProvenance, toEvidenceLevel } from "@fusorb/intel-evidence"
import type { ExtractedPackage, ExtractedModule, ExtractedDocument } from "./types.js"

type ProvLevel = "verified" | "strongly_supported" | "inferred" | "unknown"
type ProvSourceType = "file" | "commit" | "human_statement" | "inferred_pattern"
interface PackageRef {
  id: string
  sourcePath: string
}

interface ProvenanceFields {
  sourcePath: string
  sourceCommitSha: string
  retrievedAt: Date
  evidenceLevel: ProvLevel
  sourceType: ProvSourceType
}

/**
 * Build the provenance fields for a DB write. createProvenance validates the
 * evidence level and yields a `retrievedAt` timestamp; the level/sourceType are
 * re-emitted as plain string literals so they typecheck directly against the
 * Prisma-generated enum input types.
 */
function provenance(
  sourcePath: string,
  commitSha: string,
  level: ProvLevel,
  sourceType: ProvSourceType,
): ProvenanceFields {
  createProvenance(sourcePath, commitSha, toEvidenceLevel(level))
  return {
    sourcePath,
    sourceCommitSha: commitSha,
    retrievedAt: new Date(),
    evidenceLevel: level,
    sourceType,
  }
}

export async function upsertRepository(
  name: string,
  url: string | null,
  branch: string | null,
  commitSha: string | null,
  sourcePath: string,
  sourceType: ProvSourceType,
  level: ProvLevel,
): Promise<string> {
  const row = await prisma.repository.upsert({
    where: { name },
    create: {
      name,
      url,
      defaultBranch: branch,
      ...provenance(sourcePath, commitSha ?? "", level, sourceType),
    },
    update: {
      url,
      defaultBranch: branch,
      ...provenance(sourcePath, commitSha ?? "", level, sourceType),
      removedAt: null,
    },
  })
  return row.id
}

export async function upsertPackage(
  repositoryId: string,
  pkg: ExtractedPackage,
  commitSha: string,
): Promise<string> {
  return (
    await prisma.package.upsert({
      where: { repositoryId_name: { repositoryId, name: pkg.name } },
      create: {
        repositoryId,
        name: pkg.name,
        version: pkg.version,
        description: pkg.description,
        dependencies: pkg.dependencies ?? undefined,
        devDependencies: pkg.devDependencies ?? undefined,
        ...provenance(pkg.sourcePath, commitSha, "verified", "file"),
      },
      update: {
        name: pkg.name,
        version: pkg.version,
        description: pkg.description,
        dependencies: pkg.dependencies ?? undefined,
        devDependencies: pkg.devDependencies ?? undefined,
        ...provenance(pkg.sourcePath, commitSha, "verified", "file"),
        removedAt: null,
      },
    })
  ).id
}

export async function upsertModule(
  repositoryId: string,
  mod: ExtractedModule,
  commitSha: string,
): Promise<string> {
  return (
    await prisma.module.upsert({
      where: { repositoryId_path: { repositoryId, path: mod.path } },
      create: {
        repositoryId,
        name: mod.name,
        path: mod.path,
        description: mod.description,
        ...provenance(mod.sourcePath, commitSha, "verified", "file"),
      },
      update: {
        name: mod.name,
        path: mod.path,
        description: mod.description,
        ...provenance(mod.sourcePath, commitSha, "verified", "file"),
        removedAt: null,
      },
    })
  ).id
}

export async function upsertDocument(
  repositoryId: string,
  doc: ExtractedDocument,
  commitSha: string,
): Promise<string> {
  return (
    await prisma.document.upsert({
      where: { repositoryId_path: { repositoryId, path: doc.path } },
      create: {
        repositoryId,
        path: doc.path,
        title: doc.title ?? undefined,
        description: doc.description ?? undefined,
        content: doc.content ?? undefined,
        ...provenance(doc.sourcePath, commitSha, "verified", "file"),
      },
      update: {
        path: doc.path,
        title: doc.title ?? undefined,
        description: doc.description ?? undefined,
        content: doc.content ?? undefined,
        ...provenance(doc.sourcePath, commitSha, "verified", "file"),
        removedAt: null,
      },
    })
  ).id
}

export async function linkContains(
  repositoryId: string,
  targetId: string,
  targetType: "PACKAGE" | "MODULE" | "DOCUMENT",
  sourcePath: string,
  commitSha: string,
): Promise<void> {
  await prisma.relationship.upsert({
    where: {
      fromEntityId_toEntityId_fromEntityType_toEntityType_kind: {
        fromEntityId: repositoryId,
        toEntityId: targetId,
        fromEntityType: "REPOSITORY",
        toEntityType: targetType,
        kind: "CONTAINS",
      },
    },
    create: {
      fromEntityId: repositoryId,
      toEntityId: targetId,
      fromEntityType: "REPOSITORY",
      toEntityType: targetType,
      kind: "CONTAINS",
      ...provenance(sourcePath, commitSha, "verified", "file"),
    },
    update: {
      ...provenance(sourcePath, commitSha, "verified", "file"),
      removedAt: null,
    },
  })
}

let npmRepositoryIdCache: string | null = null

/** The synthetic repository that holds external (non-ingested) package placeholders. */
export async function ensureNpmRepository(): Promise<string> {
  if (npmRepositoryIdCache) return npmRepositoryIdCache
  npmRepositoryIdCache = await upsertRepository(
    "npm",
    null,
    null,
    null,
    "npm",
    "inferred_pattern",
    "inferred",
  )
  return npmRepositoryIdCache
}

export async function ensureExternalPackage(
  npmRepositoryId: string,
  name: string,
): Promise<string> {
  return (
    await prisma.package.upsert({
      where: { repositoryId_name: { repositoryId: npmRepositoryId, name } },
      create: {
        repositoryId: npmRepositoryId,
        name,
        version: null,
        description: null,
        dependencies: undefined,
        devDependencies: undefined,
        ...provenance("npm:" + name, "", "inferred", "inferred_pattern"),
      },
      update: {
        version: null,
        description: null,
        dependencies: undefined,
        devDependencies: undefined,
        ...provenance("npm:" + name, "", "inferred", "inferred_pattern"),
        removedAt: null,
      },
    })
  ).id
}

async function resolveDependencyTarget(
  dependencyName: string,
  npmRepositoryId: string,
): Promise<string> {
  const match = await prisma.package.findFirst({
    where: { name: dependencyName, repository: { name: { not: "npm" } } },
    select: { id: true },
  })
  if (match) return match.id
  return ensureExternalPackage(npmRepositoryId, dependencyName)
}

export async function linkConsumes(
  sourcePkgId: string,
  targetPkgId: string,
  range: string,
  sourcePath: string,
  commitSha: string,
): Promise<void> {
  await prisma.relationship.upsert({
    where: {
      fromEntityId_toEntityId_fromEntityType_toEntityType_kind: {
        fromEntityId: sourcePkgId,
        toEntityId: targetPkgId,
        fromEntityType: "PACKAGE",
        toEntityType: "PACKAGE",
        kind: "CONSUMES",
      },
    },
    create: {
      fromEntityId: sourcePkgId,
      toEntityId: targetPkgId,
      fromEntityType: "PACKAGE",
      toEntityType: "PACKAGE",
      kind: "CONSUMES",
      note: range,
      ...provenance(sourcePath, commitSha, "inferred", "file"),
    },
    update: {
      note: range,
      ...provenance(sourcePath, commitSha, "inferred", "file"),
      removedAt: null,
    },
  })
}

/**
 * For every dependency/devDependency of a package, upsert a CONSUMES edge whose
 * target is either the ingested package it resolves to or an external placeholder.
 */
export async function syncPackageConsumes(
  pkg: PackageRef,
  dependencies: Record<string, string> | null,
  devDependencies: Record<string, string> | null,
  commitSha: string,
): Promise<number> {
  const npmRepositoryId = await ensureNpmRepository()
  let edges = 0
  for (const [name, spec] of Object.entries(dependencies ?? {})) {
    const targetId = await resolveDependencyTarget(name, npmRepositoryId)
    await linkConsumes(pkg.id, targetId, spec, pkg.sourcePath, commitSha)
    edges++
  }
  for (const [name, spec] of Object.entries(devDependencies ?? {})) {
    const targetId = await resolveDependencyTarget(name, npmRepositoryId)
    await linkConsumes(pkg.id, targetId, spec, pkg.sourcePath, commitSha)
    edges++
  }
  return edges
}

/** Mark pre-existing entities for a repo as stale (soft delete) so re-ingests converge. */
export async function markStale(repositoryId: string): Promise<void> {
  const now = new Date()
  await prisma.package.updateMany({
    where: { repositoryId, removedAt: null },
    data: { removedAt: now },
  })
  await prisma.module.updateMany({
    where: { repositoryId, removedAt: null },
    data: { removedAt: now },
  })
  await prisma.document.updateMany({
    where: { repositoryId, removedAt: null },
    data: { removedAt: now },
  })
}
