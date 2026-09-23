# API Contract

Public interfaces for the `@fusorb/intel-*` packages. This document is the source of truth
for each package's public surface — it is regenerated against the actual TypeScript source.

---

## `@fusorb/intel-evidence`

Zero-dependency vocabulary layer. Re-exported through `@fusorb/intel-graph`.

```ts
enum EvidenceLevel {
  verified            // read directly from a file
  strongly_supported  // backed by strong but indirect evidence
  inferred            // synthesized (e.g. dependency edge from package.json)
  unknown             // not yet assessed
}

interface ProvenanceData {
  sourcePath: string          // "src/foo.ts", "npm:@fusorb/facet-components"
  sourceCommitSha: string | null
  retrievedAt: Date
  evidenceLevel: EvidenceLevel
}

function toEvidenceLevel(level: string): EvidenceLevel
function evidenceLevelToString(level: EvidenceLevel): string
function createProvenance(
  sourcePath: string,
  commitSha: string | null,
  level: EvidenceLevel,
): ProvenanceData
function isVerifiedOrStronger(level: EvidenceLevel): boolean
```

---

## `@fusorb/intel-graph`

Lazy Prisma client singleton — importing `@fusorb/intel-graph` does **not** require `DATABASE_URL`.
The connection pool is created on first database access.

```ts
const prisma: PrismaClient  // Proxy — lazy, connection deferred

// Re-exports from evidence
export { EvidenceLevel, toEvidenceLevel, evidenceLevelToString, isVerifiedOrStronger } from "@fusorb/intel-evidence"
export type { ProvenanceData, EvidenceLevel as EvidenceLevelType }
```

### Provenance helpers

```ts
type ProvLevel = "verified" | "strongly_supported" | "inferred" | "unknown"
type ProvSourceType = "file" | "commit" | "human_statement" | "inferred_pattern"

interface ProvenanceFields {
  sourcePath: string
  sourceType: SourceType
  sourceCommitSha: string | null
  firstSeenAt: Date
  retrievedAt: Date
  removedAt: Date | null
  evidenceLevel: EvidenceLevel
}

function provenance(
  sourcePath: string,
  sourceCommitSha: string | null,
  level: ProvLevel,
  sourceType: ProvSourceType,
  retrievedAt?: Date,
): ProvenanceFields
```

### Graph operations

All functions accept repository-scoped parameters and return the relevant DB id
(`string`) or void. `linkContains` and `linkConsumes` return `Promise<void>`.
`syncPackageConsumes` returns `Promise<number>` (edge count).

```ts
function markStale(repositoryId: string): Promise<void>
function upsertRepository(name: string, url: string | null, defaultBranch: string | null,
  commitSha: string | null, sourcePath: string, sourceType: ProvSourceType,
  level: ProvLevel): Promise<string>
function upsertPackage(repoId: string, pkg: ExtractedPackage, commitSha: string | null): Promise<string>
function upsertModule(repoId: string, mod: ExtractedModule, commitSha: string | null): Promise<string>
function upsertDocument(repoId: string, doc: ExtractedDocument, commitSha: string | null): Promise<string>
function linkContains(repositoryId: string, targetId: string, targetType: "PACKAGE" | "MODULE" | "DOCUMENT",
  sourcePath: string, commitSha: string | null): Promise<void>
function linkConsumes(repoId: string, sourcePkgId: string, targetPkgId: string,
  range: string, depType: DependencyType | null, sourcePath: string,
  commitSha: string | null): Promise<void>
function syncPackageConsumes(pkg: PackageRef, dependencies: Record<string, string> | null,
  devDependencies: Record<string, string> | null, peerDependencies: Record<string, string> | null,
  optionalDependencies: Record<string, string> | null, commitSha: string | null): Promise<number>
function startIngestionRun(repositoryId: string, commitSha: string, branch: string | null): Promise<string>
function completeIngestionRun(
  runId: string,
  status: "success" | "failed",
  counts: {
    packages: number
    modules: number
    documents: number
    symbols: number
    consumesEdges: number
    containsEdges: number
    symbolFilesParsed: number
    symbolFilesSkipped: number
    symbolFilesErrored: number
  },
  errors?: string[],
  warnings?: string[],
): Promise<void>
```

---

## `@fusorb/intel-ingest`

### Ingestion entry point

```ts
async function ingestRepo(repoUrl: string, branch: string | null = null): Promise<IngestSummary>

interface IngestSummary {
  repo: string
  commitSha: string
  branch: string | null
  packages: number
  modules: number
  documents: number
  symbols: number
  consumesEdges: number
  containsEdges: number
  symbolFilesParsed: number     // .ts/.tsx files successfully parsed
  symbolFilesSkipped: number    // files beyond size cap (MAX_SYMBOL_FILE_SIZE = 200_000)
  symbolFilesErrored: number    // files with parse errors
  warnings: string[]            // non-fatal diagnostics (skips, parse errors, per-symbol DB errors)
}
```

### Extraction

```ts
function extractRepo(repoRoot: string): ExtractedRepo
function collectSourceFiles(repoRoot: string): ScannedFile[]

// Constants
const MAX_SYMBOL_FILES = 300
const MAX_SYMBOL_FILE_SIZE = 200_000
```

### Git utilities

```ts
const AGENT_REPOS: string  // resolves to .agent/repos at process.cwd()
function repositoryNameFromUrl(url: string): string
function cloneOrFetch(repoUrl: string, dest: string, branch: string | null): string
function currentCommit(dest: string): string
function defaultBranch(dest: string): string | null
```

### Symbol extraction

Requires the `typescript` package as an **optional** dependency. If `typescript` is
not installed, `parseTypeScriptFile` returns a `ParseResult` with a single error string
and an empty symbols list — ingestion continues without symbol-level data.

`parseTypeScriptFile` and `parseFile` are **async** because they dynamically `import("typescript")`
at runtime, so the TypeScript compiler API is only loaded when actually needed.

```ts
type SymbolKind = "class" | "const" | "enum" | "function" | "interface" | "type" | "variable"

interface SymbolInfo {
  name: string              // declaration name
  kind: SymbolKind
  line: number              // 1-indexed line number
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
  symbols: SymbolInfo[]
  imports: ImportInfo[]
  exports: ExportInfo[]
  errors: string[]           // non-fatal (e.g. "typescript package is not installed",
                             // or individual parse diagnostics captured from the TS compiler)
}

// Returned by linkSymbols — failures are observable, never silently swallowed as `0 symbols`.
interface SymbolInsertResult {
  count: number
  errors: string[]           // parse errors + per-symbol DB errors (if any)
  parseFailed: boolean       // true when the file could not be parsed (parse errors only)
}

// Dispatches by file extension. Returns null for unsupported extensions (.js, .py, etc.).
async function parseFile(filePath: string, source: string): Promise<ParseResult | null>

// Parses a single .ts/.tsx file. Returns a ParseResult with diagnostics in `errors`.
async function parseTypeScriptFile(filePath: string, source: string): Promise<ParseResult>

// Upserts symbols into the DB with full provenance. Parse errors short-circuit
// (returns { count: 0, errors: [...], parseFailed: true }). Per-symbol DB errors
// are collected in `errors` (returns { count: N, errors: [...], parseFailed: false }).
async function linkSymbols(
  repositoryId: string,
  filePath: string,
  source: string,
  commitSha: string | null,
): Promise<SymbolInsertResult>
```

### Evidence policy

| What is being recorded                         | EvidenceLevel      | Notes                                              |
|------------------------------------------------|--------------------|----------------------------------------------------|
| Entity read directly from a repository file    | `verified`         | Packages, modules, documents, symbols              |
| AST-derived symbol declaration                 | `verified`         | Source code is the evidence                        |
| Repository record (ingested repo)              | `verified`         | Source of truth: the repo itself                   |
| `CONSUMES` relationship (from package.json)     | `inferred`         | Derived from manifest dependency, not the dep itself |
| External npm package (placeholder)             | `inferred`        | Inferred from dependency reference, not ingested   |
| Ingestion run record                           | `inferred`        | Run is a derived artifact, sourceType `inferred_pattern` |
| `CONTAINS` relationship                        | `verified`        | Observed from repository structure                 |
| Architectural decision (human statement)       | `verified`        | Human-asserted, confirmed by architect             |
| `DependencyType` on a `CONSUMES` edge         | `inferred`        | Derived from which manifest section it appeared in |

**Key rule**: LLM/retrieval interpretation **never** carries repository evidence.
The `inferred` level is only for facts derived from a repository's own files
(e.g. a dependency edge derived from `package.json`). External packages that are
not ingested are `inferred` from the reference alone — they have no `sourceCommitSha`
and a synthetic `sourcePath` like `"npm:package-name"`.

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
interface RetrievedEntity {
  entityType: string
  id: string
  name: string
  path: string
  description: string | null
  content: string | null
  provenance: ProvenanceInfo
  score: number
  repositoryName?: string | null   // populated when known; null when not
}

interface RetrievedDocument {
  path: string
  repositoryName?: string | null
  content: string | null
  provenance: ProvenanceInfo
  score: number
}

interface RetrievedRelationship {
  id: string
  kind: string
  fromId: string
  fromType: string
  fromName: string
  toId: string
  toType: string
  toName: string
  note: string | null
  depType: string | null
  evidenceLevel: string
  repositoryName: string | null
}

interface RetrievalResult {
  entities: RetrievedEntity[]
  relationships: RetrievedRelationship[]
  documents: RetrievedDocument[]
}

function extractKeywords(question: string): string[]

async function searchPackage(query: string, includeExternal?: boolean): Promise<RetrievedEntity[]>
async function searchRepository(name: string): Promise<RetrievedEntity[]>

interface SearchOptions {
  query: string
  includeExternal?: boolean
  includeRelationships?: boolean
  keywordLimit?: number
  entityLimit?: number
}
async function searchContent(options: SearchOptions): Promise<RetrievalResult>

async function getDependencies(
  repositoryName: string,
  packageName: string,
  includeExternal: boolean,
): Promise<RetrievalResult>

async function getPackageDependencies(
  repositoryName: string,
  packageName: string,
  includeExternal: boolean,
): Promise<PackageDependencies>

async function getDependents(
  repositoryName: string,
  packageName: string,
  includeExternal: boolean,
): Promise<RetrievalResult>

async function traverseRelationships(
  fromEntityId: string,
  fromEntityType: string,
  kinds: string[],
  depth?: number,
): Promise<RetrievedRelationship[]>

async function readDocumentContent(
  repositoryName: string,
  contentPath: string,
): Promise<string>

async function getActiveDecisions(): Promise<RetrievedEntity[]>
async function getDecisionViolations(): Promise<RetrievalResult>
async function getGovernedEntities(options: { entityType?: string; relationshipType?: string }): Promise<RetrievalResult>

interface RetrieveOptions {
  limit?: number
  repositoryName?: string
}
async function retrieve(question: string, options?: RetrieveOptions): Promise<RetrievalResult>

function formatContext(result: RetrievalResult): string
```

---

## `@fusorb/intel-tools`

Read-only wrappers around retrieval. Provides a `ToolResult` interface for use in agentic
loops:

```ts
interface ToolResult<T> {
  success: boolean
  data: T | null
  error?: string
}

async function searchRepo(query: string, opts?: { includeExternal?: boolean }): Promise<string>
async function readDocument(name: string): Promise<string>
async function inspectDependencies(name: string, opts?: { includeExternal?: boolean }): Promise<string>
```
