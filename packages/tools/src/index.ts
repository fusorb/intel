import {
  searchContent,
  readDocumentContent,
  getPackageDependencies,
} from "@fusorb/intel-retrieval"
import type {
  RetrievalResult,
  RetrievedDocument,
  PackageDependencies,
} from "@fusorb/intel-retrieval"

// --- Tool result types ---

export interface ToolResult<T> {
  data: T
  source: string
}

// --- search_repo ---

/**
 * Keyword/substring search across all entity types in the knowledge graph.
 * Wraps retrieval.searchContent.
 */
export async function searchRepo(
  query: string,
): Promise<ToolResult<RetrievalResult>> {
  const result = await searchContent(query, 50)
  return { data: result, source: "intel-retrieval.searchContent" }
}

// --- read_document ---

/**
 * Read a document's full text content and provenance from the graph.
 * Looks up by repository name and document path.
 */
export async function readDocument(
  repositoryName: string,
  path: string,
): Promise<ToolResult<RetrievedDocument | null>> {
  const doc = await readDocumentContent(repositoryName, path)
  return {
    data: doc,
    source: `intel-retrieval.readDocumentContent (${repositoryName}/${path})`,
  }
}

// --- inspect_dependencies ---

/**
 * Inspect a package's CONSUMES edges. Returns both resolved-to-ingested
 * packages and external npm placeholders, each with provenance.
 */
export async function inspectDependencies(
  repositoryName: string,
  packageName: string,
): Promise<ToolResult<PackageDependencies | null>> {
  const deps = await getPackageDependencies(repositoryName, packageName)
  return {
    data: deps,
    source: `intel-retrieval.getPackageDependencies (${repositoryName}/${packageName})`,
  }
}
