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

/** Entity/edge counts recorded on an IngestionRun at completion. */
interface RunCounts {
  packages: number
  modules: number
  documents: number
  symbols: number
  consumesEdges: number
  containsEdges: number
  referencesEdges: number
  symbolFilesParsed: number
  symbolFilesSkipped: number
  symbolFilesErrored: number
}

/** Zeroed completion counts, used when a run fails before any entity is written. */
const EMPTY_RUN_COUNTS: RunCounts = {
  packages: 0,
  modules: 0,
  documents: 0,
  symbols: 0,
  consumesEdges: 0,
  containsEdges: 0,
  referencesEdges: 0,
  symbolFilesParsed: 0,
  symbolFilesSkipped: 0,
  symbolFilesErrored: 0,
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
  let referencesEdges = 0

  // Complete the run at most once. `finalized` flips only after the write
  // succeeds, so a failure inside completeIngestionRun is retried by the catch.
  let finalized = false
  const finalize = async (
    status: "success" | "failed",
    counts: RunCounts,
    errs?: string[],
    warns?: string[],
  ): Promise<void> => {
    if (finalized) return
    await completeIngestionRun(runId, status, counts, errs, warns)
    finalized = true
  }

  try {
    const extracted = extractRepo(dest)

    // Guard: never soft-delete a repo's graph on the strength of an empty
    // extraction (bad branch, partial clone, or an unreadable tree). Without
    // this, a failed walk would tombstone every existing entity while the run
    // still reported success.
    if (
      extracted.packages.length === 0 &&
      extracted.modules.length === 0 &&
      extracted.documents.length === 0
    ) {
      const message =
        `extraction found no packages/modules/documents for ${repoName} at ${commitSha} — ` +
        `refusing to mark the existing graph stale`
      await finalize("failed", EMPTY_RUN_COUNTS, [message])
      throw new Error(message)
    }

    // Re-ingest is idempotent: soft-delete stale rows, then refresh the current set.
    await markStale(repoId)

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
        const { count, references: refEdges, errors: symErrors, parseFailed } =
          await linkSymbols(repoId, sf.rel, source, commitSha)
        symbolsCount += count
        referencesEdges += refEdges
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

    await finalize(
      errors.length > 0 ? "failed" : "success",
      {
        packages: packagesCount,
        modules: modulesCount,
        documents: documentsCount,
        symbols: symbolsCount,
        consumesEdges,
        containsEdges,
        referencesEdges,
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
      referencesEdges,
      symbolFilesParsed,
      symbolFilesSkipped,
      symbolFilesErrored,
      warnings,
    }
  } catch (err) {
    // Guarantee the run is always completed — never left stuck on "running" —
    // even when a step outside the per-item try/catch blocks throws.
    try {
      await finalize(
        "failed",
        {
          packages: packagesCount,
          modules: modulesCount,
          documents: documentsCount,
          symbols: symbolsCount,
          consumesEdges,
          containsEdges,
          referencesEdges,
          symbolFilesParsed,
          symbolFilesSkipped,
          symbolFilesErrored,
        },
        [err instanceof Error ? err.message : String(err)],
      )
    } catch {
      // The original error is primary; a failed finalize must not mask it.
    }
    throw err
  }
}
