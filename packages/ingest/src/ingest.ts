import { resolve } from "node:path"
import { readFileSync, statSync } from "node:fs"
import { repositoryNameFromUrl, cloneOrFetch, defaultBranch, AGENT_REPOS } from "./git.js"
import { extractRepo, collectSourceFiles } from "./extract.js"
import { linkSymbols } from "./parser.js"
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

/** Cap total TS/TSX files parsed per repo to bound ingestion cost. */
const MAX_SYMBOL_FILES = 300
/** Skip files larger than this to avoid expensive parsing of generated/bundled output. */
const MAX_SYMBOL_FILE_SIZE = 200_000

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
  const warnings: string[] = []
  const inserted: InsertedPackage[] = []
  let packagesCount = 0
  let modulesCount = 0
  let documentsCount = 0
  let symbolsCount = 0
  let symbolFilesParsed = 0
  let symbolFilesSkipped = 0
  let symbolFilesErrored = 0
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

  // Extract symbols from each TS/TSX source file.
  // Bounded by MAX_SYMBOL_FILES / MAX_SYMBOL_FILE_SIZE to keep ingestion cost predictable.
  const sourceFiles = collectSourceFiles(dest)
  for (const sf of sourceFiles) {
    if (symbolFilesParsed + symbolFilesErrored >= MAX_SYMBOL_FILES) break
    let fileSize: number
    try {
      fileSize = statSync(sf.abs).size
    } catch (err) {
      errors.push(
        `symbol stat ${sf.rel}: ${err instanceof Error ? err.message : String(err)}`,
      )
      continue
    }
    if (fileSize > MAX_SYMBOL_FILE_SIZE) {
      symbolFilesSkipped++
      warnings.push(
        `symbol skip (size ${fileSize}B > ${MAX_SYMBOL_FILE_SIZE}B): ${sf.rel}`,
      )
      continue
    }
    try {
      const source = readFileSync(sf.abs, "utf-8")
      const { count, errors: symErrors, parseFailed } = await linkSymbols(
        repoId,
        sf.rel,
        source,
        commitSha,
      )
      symbolsCount += count
      if (parseFailed) {
        symbolFilesErrored++
      } else {
        symbolFilesParsed++
      }
      if (symErrors.length > 0) {
        warnings.push(...symErrors)
      }
    } catch (err) {
      symbolFilesErrored++
      errors.push(
        `symbol ${sf.rel}: ${err instanceof Error ? err.message : String(err)}`,
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
      symbols: symbolsCount,
      consumesEdges,
      containsEdges,
      symbolFilesParsed,
      symbolFilesSkipped,
      symbolFilesErrored,
    },
    errors.length > 0 ? errors : undefined,
    warnings.length > 0 ? warnings : undefined,
  )

  return {
    repo: repoName,
    commitSha,
    branch: effectiveBranch,
    packages: packagesCount,
    modules: modulesCount,
    documents: documentsCount,
    symbols: symbolsCount,
    consumesEdges,
    containsEdges,
    symbolFilesParsed,
    symbolFilesSkipped,
    symbolFilesErrored,
    warnings,
  }
}
