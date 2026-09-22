import { prisma } from "@fusorb/intel-graph"
import type { DependencyType } from "@prisma/client"
import { createProvenance, toEvidenceLevel } from "@fusorb/intel-evidence"
import type { ExtractedPackage, ExtractedModule, ExtractedDocument } from "./types.js"

export type ProvLevel = "verified" | "strongly_supported" | "inferred" | "unknown"
export type ProvSourceType = "file" | "commit" | "human_statement" | "inferred_pattern"

interface PackageRef {
  id: string
  sourcePath: string
}

export interface ProvenanceFields {
  sourcePath: string
  sourceCommitSha: string | null
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
export function provenance(
  sourcePath: string,
  commitSha: string | null,
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
      ...provenance(sourcePath, commitSha, level, sourceType),
    },
    update: {
      url,
      defaultBranch: branch,
      ...provenance(sourcePath, commitSha, level, sourceType),
      removedAt: null,
    },
  })
  return row.id
}

export async function upsertPackage(
  repositoryId: string,
  pkg: ExtractedPackage,
  commitSha: string | null,
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
        peerDependencies: pkg.peerDependencies ?? undefined,
        optionalDependencies: pkg.optionalDependencies ?? undefined,
        ...provenance(pkg.sourcePath, commitSha, "verified", "file"),
      },
      update: {
        name: pkg.name,
        version: pkg.version,
        description: pkg.description,
        dependencies: pkg.dependencies ?? undefined,
        devDependencies: pkg.devDependencies ?? undefined,
        peerDependencies: pkg.peerDependencies ?? undefined,
        optionalDependencies: pkg.optionalDependencies ?? undefined,
        ...provenance(pkg.sourcePath, commitSha, "verified", "file"),
        removedAt: null,
      },
    })
  ).id
}

export async function upsertModule(
  repositoryId: string,
  mod: ExtractedModule,
  commitSha: string | null,
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
  commitSha: string | null,
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
  commitSha: string | null,
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
        peerDependencies: undefined,
        optionalDependencies: undefined,
        ...provenance("npm:" + name, null, "inferred", "inferred_pattern"),
      },
      update: {
        version: null,
        description: null,
        dependencies: undefined,
        devDependencies: undefined,
        peerDependencies: undefined,
        optionalDependencies: undefined,
        ...provenance("npm:" + name, null, "inferred", "inferred_pattern"),
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
  range: string | null,
  depType: DependencyType | null,
  sourcePath: string,
  commitSha: string | null,
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
      depType,
      ...provenance(sourcePath, commitSha, "inferred", "file"),
    },
    update: {
      note: range,
      depType,
      ...provenance(sourcePath, commitSha, "inferred", "file"),
      removedAt: null,
    },
  })
}

/**
 * For every dependency/devDependency/peerDependency/optionalDependency of a
 * package, upsert a CONSUMES edge whose target is either the ingested package
 * it resolves to or an external placeholder. Each edge is tagged with its
 * dependency type so they are not collapsed into an undifferentiated edge.
 */
export async function syncPackageConsumes(
  pkg: PackageRef,
  dependencies: Record<string, string> | null,
  devDependencies: Record<string, string> | null,
  peerDependencies: Record<string, string> | null,
  optionalDependencies: Record<string, string> | null,
  commitSha: string | null,
): Promise<number> {
  const npmRepositoryId = await ensureNpmRepository()
  let edges = 0
  for (const [name, spec] of Object.entries(dependencies ?? {})) {
    const targetId = await resolveDependencyTarget(name, npmRepositoryId)
    await linkConsumes(pkg.id, targetId, spec, "dependency", pkg.sourcePath, commitSha)
    edges++
  }
  for (const [name, spec] of Object.entries(devDependencies ?? {})) {
    const targetId = await resolveDependencyTarget(name, npmRepositoryId)
    await linkConsumes(pkg.id, targetId, spec, "dev", pkg.sourcePath, commitSha)
    edges++
  }
  for (const [name, spec] of Object.entries(peerDependencies ?? {})) {
    const targetId = await resolveDependencyTarget(name, npmRepositoryId)
    await linkConsumes(pkg.id, targetId, spec, "peer", pkg.sourcePath, commitSha)
    edges++
  }
  for (const [name, spec] of Object.entries(optionalDependencies ?? {})) {
    const targetId = await resolveDependencyTarget(name, npmRepositoryId)
    await linkConsumes(pkg.id, targetId, spec, "optional", pkg.sourcePath, commitSha)
    edges++
  }
  return edges
}

/** Mark pre-existing entities and relationships for a repo as stale (soft delete)
 *  so re-ingests converge. Stale rows are reactivated by upsert when the entity
 *  is still present in the current snapshot; rows for removed entities stay stale. */
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
  await prisma.symbol.updateMany({
    where: { repositoryId, removedAt: null },
    data: { removedAt: now },
  })

  // Mark stale CONTAINS relationships from this repository
  await prisma.relationship.updateMany({
    where: {
      fromEntityId: repositoryId,
      fromEntityType: "REPOSITORY",
      kind: "CONTAINS",
      removedAt: null,
    },
    data: { removedAt: now },
  })

  // Mark stale CONSUMES relationships from packages belonging to this repository
  const pkgIds = await prisma.package.findMany({
    where: { repositoryId },
    select: { id: true },
  })
  if (pkgIds.length > 0) {
    await prisma.relationship.updateMany({
      where: {
        fromEntityId: { in: pkgIds.map((p) => p.id) },
        fromEntityType: "PACKAGE",
        kind: "CONSUMES",
        removedAt: null,
      },
      data: { removedAt: now },
    })
  }
}

/** Record the start of an ingestion run and return its ID. */
export async function startIngestionRun(
  repositoryId: string,
  commitSha: string,
  branch: string | null,
): Promise<string> {
  const row = await prisma.ingestionRun.create({
    data: {
      repositoryId,
      commitSha,
      branch,
      startedAt: new Date(),
      status: "running",
      ...provenance("ingest", commitSha, "inferred", "inferred_pattern"),
    },
  })
  return row.id
}

/** Update an ingestion run's completion status and counts. */
export async function completeIngestionRun(
  runId: string,
  status: "success" | "failed",
  counts: {
    packages: number
    modules: number
    documents: number
    symbols: number
    consumesEdges: number
    containsEdges: number
  },
  errors?: string[],
): Promise<void> {
  await prisma.ingestionRun.update({
    where: { id: runId },
    data: {
      completedAt: new Date(),
      status,
      packagesCount: counts.packages,
      modulesCount: counts.modules,
      documentsCount: counts.documents,
      symbolsCount: counts.symbols,
      consumesEdges: counts.consumesEdges,
      containsEdges: counts.containsEdges,
      errorsJson: errors && errors.length > 0 ? JSON.stringify(errors) : undefined,
    },
  })
}
