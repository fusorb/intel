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

  // Re-ingest is idempotent: soft-delete stale rows, then refresh the current set.
  await markStale(repoId)

  const extracted = extractRepo(dest)

  const inserted: InsertedPackage[] = []
  for (const pkg of extracted.packages) {
    const id = await upsertPackage(repoId, pkg, commitSha)
    await linkContains(repoId, id, "PACKAGE", pkg.sourcePath, commitSha)
    inserted.push({ id, sourcePath: pkg.sourcePath, pkg })
  }
  for (const mod of extracted.modules) {
    const id = await upsertModule(repoId, mod, commitSha)
    await linkContains(repoId, id, "MODULE", mod.sourcePath, commitSha)
  }
  for (const doc of extracted.documents) {
    const id = await upsertDocument(repoId, doc, commitSha)
    await linkContains(repoId, id, "DOCUMENT", doc.sourcePath, commitSha)
  }

  let consumesEdges = 0
  for (const { id, sourcePath, pkg } of inserted) {
    consumesEdges += await syncPackageConsumes(
      { id, sourcePath },
      pkg.dependencies,
      pkg.devDependencies,
      commitSha,
    )
  }

  return {
    repo: repoName,
    commitSha,
    packages: extracted.packages.length,
    modules: extracted.modules.length,
    documents: extracted.documents.length,
    consumesEdges,
    containsEdges:
      extracted.packages.length + extracted.modules.length + extracted.documents.length,
  }
}
