import { resolve } from "node:path"
import { repositoryNameFromUrl, cloneOrFetch, defaultBranch, AGENT_REPOS } from "./git.js"
import { extractRepo } from "./extract.js"
import {
  upsertRepository,
  upsertPackage,
  upsertModule,
  upsertDocument,
  linkContains,
  syncPackageConsumes,
  markStale,
  startIngestionRun,
  completeIngestionRun,
  ensureNpmRepository,
} from "./graph.js"
import type { IngestSummary, ExtractedPackage } from "./types.js"

interface InsertedPackage {
  id: string
  sourcePath: string
  pkg: ExtractedPackage
}

/** Clone a repository (if needed) and persist it into the knowledge graph. */
export async function ingestRepo(
  repoUrl: string,
  branch: string | null,
): Promise<IngestSummary> {
  const repoName = repositoryNameFromUrl(repoUrl)
  const dest = resolve(AGENT_REPOS, repoName)
  const commitSha = cloneOrFetch(repoUrl, dest, branch)
  const effectiveBranch = branch ?? defaultBranch(dest)

  const repoId = await upsertRepository(
    repoName,
    repoUrl,
    effectiveBranch,
    commitSha,
    ".",
    "file",
    "verified",
  )

  const runId = await startIngestionRun(repoId, commitSha, effectiveBranch)

  // Re-ingest is idempotent: soft-delete stale rows, then refresh the current set.
  await markStale(repoId)

  const extracted = extractRepo(dest)

  const errors: string[] = []
  const inserted: InsertedPackage[] = []
  let packagesCount = 0
  let modulesCount = 0
  let documentsCount = 0
  let consumesEdges = 0
  let containsEdges = 0

  for (const pkg of extracted.packages) {
    try {
      const id = await upsertPackage(repoId, pkg, commitSha)
      packagesCount++
      await linkContains(repoId, id, "PACKAGE", pkg.sourcePath, commitSha)
      containsEdges++
      inserted.push({ id, sourcePath: pkg.sourcePath, pkg })
    } catch (err) {
      errors.push(
        `package ${pkg.name}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }
  for (const mod of extracted.modules) {
    try {
      const id = await upsertModule(repoId, mod, commitSha)
      modulesCount++
      await linkContains(repoId, id, "MODULE", mod.sourcePath, commitSha)
      containsEdges++
    } catch (err) {
      errors.push(
        `module ${mod.path}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }
  for (const doc of extracted.documents) {
    try {
      const id = await upsertDocument(repoId, doc, commitSha)
      documentsCount++
      await linkContains(repoId, id, "DOCUMENT", doc.sourcePath, commitSha)
      containsEdges++
    } catch (err) {
      errors.push(
        `document ${doc.path}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  for (const { id, sourcePath, pkg } of inserted) {
    try {
      consumesEdges += await syncPackageConsumes(
        { id, sourcePath },
        pkg.dependencies,
        pkg.devDependencies,
        pkg.peerDependencies,
        pkg.optionalDependencies,
        commitSha,
      )
    } catch (err) {
      errors.push(
        `consumes ${pkg.name}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  // Ensure the npm placeholder repository exists even if no internal package
  // referenced external deps during this run.
  await ensureNpmRepository()

  await completeIngestionRun(
    runId,
    errors.length > 0 ? "failed" : "success",
    {
      packages: packagesCount,
      modules: modulesCount,
      documents: documentsCount,
      consumesEdges,
      containsEdges,
    },
    errors.length > 0 ? errors : undefined,
  )

  return {
    repo: repoName,
    commitSha,
    branch: effectiveBranch,
    packages: packagesCount,
    modules: modulesCount,
    documents: documentsCount,
    consumesEdges,
    containsEdges,
  }
}
