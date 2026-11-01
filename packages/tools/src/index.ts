import {
  searchContent,
  readDocumentContent,
  getPackageDependencies,
  findSymbol as findSymbolRetrieval,
  findCallers as findCallersRetrieval,
  findReferences as findReferencesRetrieval,
} from "@fusorb/intel-retrieval"
import type {
  RetrievalResult,
  RetrievedDocument,
  PackageDependencies,
  RetrievedEntity,
} from "@fusorb/intel-retrieval"

// --- Tool result types ---

export interface ToolResult<T> {
  data: T
  source: string
}

// --- Tool registry ---

export interface ToolParameter {
  name: string
  type: string
  description: string
  required?: boolean
}

export interface ToolDefinition {
  name: string
  description: string
  parameters: ToolParameter[]
  handler: (args: Record<string, any>) => Promise<any>
}

const tools: Map<string, ToolDefinition> = new Map()

export function registerTool(tool: ToolDefinition): void {
  tools.set(tool.name, tool)
}

export function getToolDefinitions(): ToolDefinition[] {
  return Array.from(tools.values())
}

export async function executeTool(
  name: string,
  args: Record<string, any>,
): Promise<any> {
  const tool = tools.get(name)
  if (!tool) {
    throw new Error(`Unknown tool: ${name}`)
  }
  return tool.handler(args)
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

// --- find_symbol ---

/**
 * Find a symbol by name in the knowledge graph.
 */
export async function findSymbol(
  name: string,
  options?: { repositoryName?: string; kind?: string; limit?: number },
): Promise<ToolResult<RetrievedEntity[]>> {
  const symbols = await findSymbolRetrieval(name, options)
  return {
    data: symbols,
    source: `intel-retrieval.findSymbol (${name})`,
  }
}

// --- find_callers ---

/**
 * Find callers of a symbol (best-effort without full call graph).
 */
export async function findCallers(
  symbolId: string,
  symbolName?: string,
): Promise<ToolResult<RetrievalResult>> {
  const result = await findCallersRetrieval(symbolId, symbolName)
  return {
    data: result,
    source: `intel-retrieval.findCallers (${symbolId})`,
  }
}

// --- find_references ---

/**
 * Find references to a symbol (best-effort without full call graph).
 */
export async function findReferences(
  symbolId: string,
  symbolName?: string,
): Promise<ToolResult<RetrievalResult>> {
  const result = await findReferencesRetrieval(symbolId, symbolName)
  return {
    data: result,
    source: `intel-retrieval.findReferences (${symbolId})`,
  }
}

// --- Register default tools ---

registerTool({
  name: "search_repo",
  description: "Keyword/substring search across all entity types in the knowledge graph",
  parameters: [
    { name: "query", type: "string", description: "Search query", required: true },
  ],
  handler: async (args) => searchRepo(args.query),
})

registerTool({
  name: "read_document",
  description: "Read a document's full text content and provenance from the graph",
  parameters: [
    { name: "repositoryName", type: "string", description: "Repository name", required: true },
    { name: "path", type: "string", description: "Document path", required: true },
  ],
  handler: async (args) => readDocument(args.repositoryName, args.path),
})

registerTool({
  name: "inspect_dependencies",
  description: "Inspect a package's CONSUMES edges",
  parameters: [
    { name: "repositoryName", type: "string", description: "Repository name", required: true },
    { name: "packageName", type: "string", description: "Package name", required: true },
  ],
  handler: async (args) => inspectDependencies(args.repositoryName, args.packageName),
})

registerTool({
  name: "find_symbol",
  description: "Find a symbol by name in the knowledge graph",
  parameters: [
    { name: "name", type: "string", description: "Symbol name", required: true },
    { name: "repositoryName", type: "string", description: "Repository name", required: false },
    { name: "kind", type: "string", description: "Symbol kind", required: false },
    { name: "limit", type: "number", description: "Result limit", required: false },
  ],
  handler: async (args) => findSymbol(args.name, args),
})

registerTool({
  name: "find_callers",
  description: "Find callers of a symbol (best-effort without full call graph)",
  parameters: [
    { name: "symbolId", type: "string", description: "Symbol ID", required: true },
    { name: "symbolName", type: "string", description: "Symbol name", required: false },
  ],
  handler: async (args) => findCallers(args.symbolId, args.symbolName),
})

registerTool({
  name: "find_references",
  description: "Find references to a symbol (best-effort without full call graph)",
  parameters: [
    { name: "symbolId", type: "string", description: "Symbol ID", required: true },
    { name: "symbolName", type: "string", description: "Symbol name", required: false },
  ],
  handler: async (args) => findReferences(args.symbolId, args.symbolName),
})

