# API Contract

Public interfaces for the `@fusorb/intel-*` packages.

---

## `@fusorb/intel-evidence`

Zero-dependency vocabulary layer. Re-exported through `@fusorb/intel-graph`.

```ts
enum EvidenceLevel {
  verified          // read directly from a file
  strongly_supported // backed by strong but indirect evidence
  inferred          // synthesized (e.g. dependency edge from package.json)
  unknown           // not yet assessed
}

interface ProvenanceData {
  sourcePath: string       // "src/foo.ts", "npm:@fusorb/facet-components"
  sourceCommitSha: string | null
  retrievedAt: Date
}

function toEvidenceLevel(level: string): EvidenceLevel
function createProvenance(sourcePath: string, commitSha: string | null, level: EvidenceLevel): ProvenanceData
```

---

## `@fusorb/intel-graph`

Lazy Prisma client singleton — importing `@fusorb/intel-graph` does **not** require `DATABASE_URL`.
The connection pool is created on first database access.

```ts
const prisma: PrismaClient  // Proxy — lazy, connection deferred

// Re-exports from evidence
export { EvidenceLevel, toEvidenceLevel } from "@fusorb/intel-evidence"
export type { EvidenceLevel as EvidenceLevelType }
```

---

## `@fusorb/intel-ingest`

### Ingestion

```ts
async function ingestRepo(repoUrl: string, options?: { branch?: string }): Promise<IngestSummary>

interface IngestSummary {
  repositoryId: string
  packagesExtracted: number
  modulesExtracted: number
  documentsExtracted: number
  symbolsExtracted: number
  consumesLinked: number
  containsLinked: number
  errors: string[]
  status: "success" | "partial"
}
```

### Relationship syncing (graph layer)

```ts
function markStale(repositoryName: string): Promise<void>
function upsertRepository(...): Promise<Repository>
function upsertPackage(...): Promise<Package>
function upsertModule(...): Promise<Module>
function upsertDocument(...): Promise<Document>
function linkContains(...): Promise<number>
function linkConsumes(...): Promise<number>
function syncPackageConsumes(...): Promise<number>
function startIngestionRun(...): Promise<...>
function completeIngestionRun(...): Promise<...>
```

### Provenance helpers (re-exported from graph)

```ts
type ProvLevel = "verified" | "strongly_supported" | "inferred" | "unknown"
type ProvSourceType = "file" | "commit" | "human_statement" | "inferred_pattern"

interface ProvenanceFields {
  sourcePath: string
  sourceCommitSha: string | null
  retrievedAt: Date
  sourceType: ProvSourceType
  evidenceLevel: ProvLevel
}

function provenance(
  sourcePath: string,
  commitSha: string | null,
  level: ProvLevel,
  sourceType: ProvSourceType,
): ProvenanceFields
```

### Git utilities

```ts
function repositoryNameFromUrl(url: string): string
async function cloneOrFetch(url: string, dest: string): Promise<void>
function currentCommit(cwd: string): string
function defaultBranch(cwd: string): string
```

### Symbol extraction (wired into ingestion)

Requires the `typescript` package as an optional dependency. If `typescript` is
not installed, `parseFile` returns a result with a single error string and an
empty symbols list — ingestion continues without symbol-level data. The ingestion
pipeline parses each `.ts`/`.tsx` file and calls `linkSymbols` to upsert extracted
symbols with full provenance.

```ts
interface SymbolInfo {
  name: string              // declaration name
  kind: string               // FunctionDeclaration, ClassDeclaration, etc.
  line: number               // 1-indexed line number
  isExported: boolean
}

interface ImportInfo {
  names: string[]            // imported identifiers (local names)
  isDefault: boolean
  isNamespace: boolean
  isTypeOnly: boolean
  moduleSpecifier: string
}

interface ExportInfo {
  name: string               // exported name
  localAlias?: string        // local name if renamed (e.g. `export { foo as bar }`)
  isDefault: boolean
  isNamespace: boolean
  isTypeOnly: boolean
  reExportFrom?: string      // present only for re-exports with a module specifier
}

interface ParseResult {
  filePath: string
  source: string
  symbols: SymbolInfo[]
  imports: ImportInfo[]
  exports: ExportInfo[]
  errors: string[]           // non-fatal (e.g. "typescript package is not installed")
}

function parseTypeScriptFile(filePath: string, source: string): ParseResult
function parseFile(filePath: string, source: string): ParseResult | null  // dispatches by extension
async function linkSymbols(args: {
  repositoryId: string
  filePath: string
  source: string
  commitSha: string | null
}): Promise<number>  // wires symbols to the DB; returns count inserted
```

---

## `@fusorb/intel-provider`

```ts
interface Citation {
  sourcePath: string
  sourceCommitSha: string | null
  evidenceLevel: string
}

interface IntelligenceProvider {
  answer(question: string, context: string, citations: Citation[]): Promise<string>
  extractCitations(text: string): Citation[]
  checkUnsourcedClaims(text: string, citations: Citation[]): string[]
}
```

---

## `@fusorb/intel-retrieval`

```ts
function searchPackage(query: string, includeExternal?: boolean): Promise<PackageSearchResult[]>
function searchModule(query: string): Promise<ModuleSearchResult[]>
function searchDocument(query: string): Promise<DocumentSearchResult[]>
function traverseRelationships(
  entityId: string,
  entityType: EntityType,
  kinds: RelationshipKind[],
): Promise<RetrievedRelationship[]>
function getActiveDecisions(): Promise<Decision[]>
function formatContext(results: SearchResult[]): string
```

---

## `@fusorb/intel-tools`

Read-only wrappers around retrieval. Provides a `Tool` interface for use in agentic
loops:

```ts
interface Tool {
  name: string
  description: string
  parameters: object  // JSON schema
  execute(args: Record<string, unknown>): Promise<string>
}

function searchRepo(query: string, opts?: { includeExternal?: boolean }): Promise<string>
function readDocument(name: string): Promise<string>
function inspectDependencies(name: string, opts?: { includeExternal?: boolean }): Promise<string>
```
