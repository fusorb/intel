# API Contract

Public interfaces for the `@fusorb/intel-*` packages. This document mirrors each package's
barrel (`src/index.ts`); when in doubt, the TypeScript source is authoritative.

Packages: `evidence`, `graph`, `ingest`, `provider`, `retrieval`, `tools`, `agent`.

---

## `@fusorb/intel-evidence`

Zero-dependency vocabulary layer. Re-exported through `@fusorb/intel-graph`.

```ts
enum EvidenceLevel {
  Verified = "verified"            // read directly from a file
  StronglySupported = "strongly_supported"  // strong but indirect evidence
  Inferred = "inferred"            // synthesized (e.g. a dependency edge from package.json)
  Unknown = "unknown"              // not yet assessed
}

interface ProvenanceData {
  sourcePath: string
  sourceCommitSha: string | null
  retrievedAt: Date
  evidenceLevel: EvidenceLevel
}

function toEvidenceLevel(v: string): EvidenceLevel   // throws on unrecognized input
function evidenceLevelToString(level: EvidenceLevel): string
function createProvenance(
  sourcePath: string,
  sourceCommitSha: string | null,
  level?: EvidenceLevel,           // defaults to EvidenceLevel.Verified
): ProvenanceData
function isVerifiedOrStronger(level: EvidenceLevel): boolean
```

---

## `@fusorb/intel-graph`

Lazy Prisma client singleton — importing `@fusorb/intel-graph` does **not** require
`DATABASE_URL`. The connection pool is created on first database access (a `Proxy` defers
`buildPool()`/`buildClient()` until then).

```ts
const prisma: PrismaClient          // lazy Proxy — connection deferred

// Prisma enum re-exports
export { EntityType, RelationshipKind, DependencyType } from "@prisma/client"
export type { Prisma } from "@prisma/client"

// Everything from @fusorb/intel-evidence is re-exported here too
export * from "@fusorb/intel-evidence"
```

### Schema (six entities + `Relationship`)

`Repository`, `Package`, `Module`, `Symbol`, `Document`, `Decision` — plus a polymorphic
`Relationship` join table (`fromEntityId`/`toEntityId` + `fromEntityType`/`toEntityType`,
`kind`, `note`, `depType`). Every row carries provenance. `RelationshipKind`:
`CONTAINS`, `CONSUMES`, `DEPENDS_ON`, `RENAMED_FROM`, `DOCUMENTS`, `EXPORTS`, `DEFINES`,
`REFERENCES`, `GOVERNS`, `VIOLATES`.

---

## `@fusorb/intel-ingest`

Repo cloning, file-tree walking, entity + symbol extraction, and all graph writes. CLI:
`pnpm ingest <repo-url> [--branch <branch>]`.

### Entry point

```ts
async function ingestRepo(repoUrl: string, branch: string | null): Promise<IngestSummary>

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
  referencesEdges: number      // REFERENCES call-graph edges written
  symbolFilesParsed: number
  symbolFilesSkipped: number
  symbolFilesErrored: number
  warnings: string[]
}
```

### Graph operations

All writes set full provenance. `provenance(...)` validates the evidence level and stamps
`retrievedAt`.

```ts
type ProvLevel = "verified" | "strongly_supported" | "inferred" | "unknown"
type ProvSourceType = "file" | "commit" | "human_statement" | "inferred_pattern"

interface ProvenanceFields {
  sourcePath: string
  sourceCommitSha: string | null
  retrievedAt: Date
  evidenceLevel: ProvLevel
  sourceType: ProvSourceType
}

function provenance(sourcePath: string, commitSha: string | null, level: ProvLevel,
  sourceType: ProvSourceType): ProvenanceFields

function markStale(repositoryId: string): Promise<void>   // soft-delete a repo's entities AND
                                                          // CONTAINS/CONSUMES/REFERENCES edges

function upsertRepository(name: string, url: string | null, branch: string | null,
  commitSha: string | null, sourcePath: string, sourceType: ProvSourceType,
  level: ProvLevel): Promise<string>
function upsertPackage(repoId: string, pkg: ExtractedPackage, commitSha: string | null): Promise<string>
function upsertModule(repoId: string, mod: ExtractedModule, commitSha: string | null): Promise<string>
function upsertDocument(repoId: string, doc: ExtractedDocument, commitSha: string | null): Promise<string>

function linkContains(repositoryId: string, targetId: string,
  targetType: "PACKAGE" | "MODULE" | "DOCUMENT", sourcePath: string,
  commitSha: string | null): Promise<void>
function linkConsumes(sourcePkgId: string, targetPkgId: string, range: string | null,
  depType: DependencyType | null, sourcePath: string, commitSha: string | null): Promise<void>
function linkReferences(fromSymbolId: string, toSymbolId: string, sourcePath: string,
  commitSha: string | null, note?: string | null): Promise<void>

function syncPackageConsumes(pkg: { id: string; sourcePath: string },
  dependencies: Record<string, string> | null,
  devDependencies: Record<string, string> | null,
  peerDependencies: Record<string, string> | null,
  optionalDependencies: Record<string, string> | null,
  commitSha: string | null): Promise<number>   // edge count

function startIngestionRun(repositoryId: string, commitSha: string, branch: string | null): Promise<string>
function completeIngestionRun(runId: string, status: "success" | "failed",
  counts: {
    packages: number; modules: number; documents: number; symbols: number
    consumesEdges: number; containsEdges: number
    symbolFilesParsed: number; symbolFilesSkipped: number; symbolFilesErrored: number
  },
  errors?: string[], warnings?: string[]): Promise<void>
```

### Decisions / governance

`Decision` rows are never ingested from the product repos: they are derived from the architecture
repo's vendored ADRs (`vendor/fusorb/decisions/*.md`, parsed by `adr.ts`) plus a small
hand-authored standard-backed remainder. `runGovernance()` upserts them by stable `key`, prunes
any Decision no longer in the seed (deleting its relationships first), writes `GOVERNS` edges, and
detects `VIOLATES` edges (retired `@arcevo/*` scope, shadcn-style UI deps, missing
`AGENTS.md`/`CLAUDE.md`). Idempotent.

```ts
interface DecisionUpsertInput {
  key: string; title: string; statement: string; status: string
  sourcePath: string; sourceCommitSha: string | null
}
function upsertDecision(input: DecisionUpsertInput): Promise<string>
function linkGoverns(decisionId: string, targetId: string,
  targetType: "REPOSITORY" | "PACKAGE" | "MODULE", note: string | null,
  sourcePath: string, commitSha: string | null): Promise<void>
function linkViolates(sourceId: string,
  sourceType: "REPOSITORY" | "PACKAGE" | "MODULE", decisionId: string,
  note: string | null, sourcePath: string, commitSha: string | null): Promise<void>

interface GovernanceSummary { decisions: number; governsEdges: number; violations: number }
function runGovernance(): Promise<GovernanceSummary>
function detectViolations(decisionIds: Map<string, string>): Promise<number>

// Decision seeds: ADR-derived (vendor/fusorb/decisions/*.md) + standard-backed remainder
const ECOSYSTEM_DECISIONS: DecisionSeed[]
interface DecisionSeed {
  key: string; title: string; statement: string; status: string
  sourcePath: string; sourceCommitSha: string | null; governs: DecisionTarget[]
}
interface DecisionTarget { type: "REPOSITORY" | "PACKAGE"; repository: string; packageName?: string }
```

### Extraction & parser

```ts
function extractRepo(repoRoot: string): ExtractedRepo      // internal (not in the barrel)
function collectSourceFiles(repoRoot: string): ScannedFile[]  // internal

const MAX_SYMBOL_FILES = 300
const MAX_SYMBOL_FILE_SIZE = 200_000

type SymbolKind =
  | "function" | "class" | "interface" | "type" | "const" | "enum"
  | "variable" | "method" | "property" | "parameter"

interface SymbolInfo {
  name: string; kind: SymbolKind
  line: number; column: number
  endLine?: number; endColumn?: number
  isExported: boolean
}
interface ImportInfo {
  specifier: string; names: string[]
  isNamespace: boolean; isDefault: boolean; isTypeOnly: boolean
}
interface ExportInfo {
  name: string; localAlias?: string
  isDefault: boolean; isWildcard: boolean; reExportFrom?: string
}
interface ReferenceInfo {                     // a call/usage reference
  fromSymbol: string                          // enclosing declaration, or "$top"
  toName: string; line: number; isCall: boolean
}

interface ParseResult {
  symbols: SymbolInfo[]; imports: ImportInfo[]; exports: ExportInfo[]
  references: ReferenceInfo[]
  errors: string[]                            // non-fatal parse diagnostics
}

interface SymbolInsertResult {
  count: number
  references: number                          // REFERENCES edges written for this file
  errors: string[]; parseFailed: boolean
}

interface FileParser { readonly extensions: string[]; parse(filePath, source): Promise<ParseResult> }

async function parseTypeScriptFile(filePath: string, source: string): Promise<ParseResult>
async function parseFile(filePath: string, source: string): Promise<ParseResult | null>
async function linkSymbols(repositoryId: string, filePath: string, source: string,
  commitSha: string | null): Promise<SymbolInsertResult>
```

`typescript` is an **optional** dependency, loaded via dynamic `import("typescript")`. If it
is missing, `parseTypeScriptFile` returns an empty result with one diagnostic and ingestion
continues without symbol data.

### Git utilities

```ts
const AGENT_REPOS: string                       // resolves to .agent/repos at process.cwd()
function repositoryNameFromUrl(url: string): string
function cloneOrFetch(repoUrl: string, dest: string, branch: string | null): string
function currentCommit(dest: string): string
function defaultBranch(dest: string): string | null
```

### Evidence policy

| What is being recorded                          | EvidenceLevel | sourceType       |
|-------------------------------------------------|---------------|------------------|
| Entity read directly from a repository file     | `verified`    | `file`           |
| AST-derived symbol declaration                  | `verified`    | `file`           |
| `CONTAINS` relationship (repo structure)        | `verified`    | `file`           |
| Architectural decision (human statement)        | `verified`    | `human_statement`|
| `CONSUMES` relationship (from package.json)     | `inferred`    | `file`           |
| `REFERENCES` call-graph edge                    | `inferred`    | `file`           |
| `VIOLATES` edge (detected)                      | `inferred`    | `file`           |
| External npm package placeholder                | `inferred`    | `inferred_pattern`|
| Ingestion run record                            | `inferred`    | `inferred_pattern`|

**Key rule**: LLM/retrieval interpretation **never** carries repository evidence. `inferred`
is only for facts derived from a repository's own files (e.g. a dependency or call edge).

---

## `@fusorb/intel-provider`

Provider-agnostic answer generation. Select a provider with `INTEL_PROVIDER`
(`mock` | `anthropic` | `ollama` | `openrouter` | `openai`; default `mock`).

```ts
interface Citation { sourcePath: string; sourceCommitSha: string | null }
interface Answer { text: string; citations: Citation[]; warnings: string[] }

interface GenerateRequest {
  question: string
  context: string
  messages?: Array<{ role: "system" | "user" | "assistant" | "tool"; content: string; tool?: string }>
  tools?: unknown[]
}

interface IntelligenceProvider {
  readonly providerName: string
  readonly modelName: string
  generate(request: GenerateRequest): Promise<Answer>
}

// Citation / evidence utilities
const CITATION_REGEX: RegExp
const DONT_KNOW_PATTERNS: RegExp[]
function extractCitations(text: string): Citation[]
function extractSourcePathsFromContext(context: string): string[]
function checkUnsourcedClaims(text: string, citations: Citation[]): string[]
function finalizeAnswer(text: string, context: string): Answer

// Prompt
const SYSTEM_PROMPT: string
function buildMessages(request: GenerateRequest): Array<{ role: string; content: string; tool?: string }>

// Implementations
class MockProvider implements IntelligenceProvider
class AnthropicProvider implements IntelligenceProvider   // AnthropicProviderOptions
class OllamaProvider implements IntelligenceProvider      // OllamaProviderOptions
class OpenRouterProvider implements IntelligenceProvider  // OpenRouterProviderOptions
class OpenAIProvider implements IntelligenceProvider      // OpenAIProviderOptions

// Factory
const DEFAULT_PROVIDER: "mock"
const VALID_PROVIDERS: readonly ["mock", "anthropic", "ollama", "openrouter", "openai"]
class ProviderConfigurationError extends Error
function createProvider(): IntelligenceProvider
```

`OpenAIProvider` is generic OpenAI-compatible: set `OPENAI_BASE_URL` to Groq, Cerebras,
Mistral, Gemini, GitHub Models, Cloudflare Workers AI, or a local server (LM Studio,
llama.cpp, vLLM, Ollama `/v1`). `OPENAI_API_KEY` is optional — local servers need none.

---

## `@fusorb/intel-retrieval`

Keyword search, graph traversal, symbol lookup, and context formatting. Every result carries
provenance; all queries filter `removedAt: null` (soft-deleted rows are excluded).

```ts
interface ProvenanceInfo {
  sourcePath: string; sourceType: string; sourceCommitSha: string | null
  firstSeenAt: Date; retrievedAt: Date; evidenceLevel: string; removedAt: Date | null
}
interface RetrievedEntity {
  entityType: string; id: string; name: string; path: string
  description: string | null; content: string | null
  provenance: ProvenanceInfo; score: number; repositoryName?: string | null
  status?: string   // DECISION only: active | proposed | superseded | deferred
}
interface RetrievedRelationship {
  id: string; kind: string
  fromId: string; fromType: string; fromName: string
  toId: string; toType: string; toName: string
  note: string | null; depType: string | null
  provenance: ProvenanceInfo; score: number
}
interface RetrievedDocument {
  path: string; repositoryName?: string | null
  content: string | null; provenance: ProvenanceInfo; score: number
}
interface RetrievalResult { entities: RetrievedEntity[]; relationships: RetrievedRelationship[]; documents: RetrievedDocument[] }

interface DependencyInfo {
  targetName: string; targetRepository: string | null; targetIsExternal: boolean
  range: string | null; depType: string | null; provenance: ProvenanceInfo
}
interface PackageDependencies {
  packageName: string; repositoryName: string
  dependencies: DependencyInfo[]; provenance: ProvenanceInfo
}

interface SearchOptions { repositoryName?: string; onlyExternal?: boolean }
interface RetrieveOptions { limit?: number; repositoryName?: string }
interface FindSymbolOptions { repositoryName?: string; kind?: string; limit?: number }

function extractKeywords(question: string): string[]

async function searchPackage(name: string, includeExternal = false): Promise<RetrievedEntity[]>
async function searchRepository(name: string): Promise<RetrievedEntity[]>
async function searchContent(query: string, limit = 20, options?: SearchOptions): Promise<RetrievalResult>

async function getDependencies(repositoryName: string): Promise<RetrievalResult>
async function getPackageDependencies(repositoryName: string, packageName: string): Promise<PackageDependencies | null>
async function getDependents(packageName: string, options?: { repositoryName?: string }): Promise<RetrievalResult>
async function traverseRelationships(entityId: string, entityType: EntityType,
  kinds?: RelationshipKind[]): Promise<RetrievedRelationship[]>
async function readDocumentContent(repositoryName: string, path: string): Promise<RetrievedDocument | null>

// Governance / decisions
async function getActiveDecisions(): Promise<RetrievedEntity[]>
async function getDecisionViolations(): Promise<RetrievalResult>
async function getGovernedEntities(decisionId: string): Promise<RetrievalResult>

// Symbol lookup
async function findSymbol(name: string, options?: FindSymbolOptions): Promise<RetrievedEntity[]>
async function findCallers(symbolId: string, symbolName?: string): Promise<RetrievalResult>
async function findReferences(symbolId: string): Promise<RetrievalResult>

// Main entry point + formatting
async function retrieve(question: string, options?: RetrieveOptions): Promise<RetrievalResult>
function formatContext(result: RetrievalResult): string
```

---

## `@fusorb/intel-tools`

Read-only wrappers over retrieval plus a tool registry for the agent loop.

```ts
interface ToolResult<T> { data: T; source: string }
interface ToolParameter { name: string; type: string; description: string; required?: boolean }
interface ToolDefinition {
  name: string; description: string
  parameters: ToolParameter[]
  handler: (args: Record<string, unknown>) => Promise<unknown>
}

function registerTool(tool: ToolDefinition): void
function getToolDefinitions(): ToolDefinition[]
function executeTool(name: string, args: Record<string, unknown>): Promise<unknown>

// Tools
async function searchRepo(query: string): Promise<ToolResult<RetrievalResult>>
async function readDocument(repositoryName: string, path: string): Promise<ToolResult<RetrievedDocument | null>>
async function inspectDependencies(repositoryName: string, packageName: string): Promise<ToolResult<PackageDependencies | null>>
async function findSymbol(name: string, options?: FindSymbolOptions): Promise<ToolResult<RetrievedEntity[]>>
async function findCallers(symbolId: string, symbolName?: string): Promise<ToolResult<RetrievalResult>>
async function findReferences(symbolId: string): Promise<ToolResult<RetrievalResult>>
```

Registered tool names: `search_repo`, `read_document`, `inspect_dependencies`,
`find_symbol`, `find_callers`, `find_references`.

---

## `@fusorb/intel-agent`

Multi-step tool-calling loop. Drives a provider and the tool registry. Used via
`pnpm ask "<question>" --agent`.

```ts
interface AgentOptions { maxSteps?: number; provider?: IntelligenceProvider }
interface AgentResult {
  answer: string
  citations: Citation[]
  warnings: string[]
  steps: number
  toolCalls: Array<{ tool: string; args: unknown; result: unknown }>
}

async function runAgent(question: string, options?: AgentOptions): Promise<AgentResult>
```

The loop asks the provider to either answer or call a tool (JSON action), executes tool calls
against `@fusorb/intel-tools`, feeds results back, and stops at `maxSteps` (default 5).

---

## `@fusorb/intel-api` (application, not a library)

`apps/api` is a thin, read-only HTTP service — the surface for the internal tool at
`intel.fusorb.com`. It is an application, not an importable package. Routes (`/health`, `/ask`,
`/ask/agent`, `/search`, `/symbols`, `/symbols/:id/{callers,references}`, `/decisions`,
`/violations`) are documented in `README.md`; the handlers live in `apps/api/src/server.ts`.

### `GET /decisions`

Returns `{ decisions: RetrievedEntity[] }` — every decision that is **not retired**
(`status` in {`active`, `proposed`}). Each `DECISION` entity carries its `status`
(`active` | `proposed` | `superseded` | `deferred`) so a client can tell a ratified decision
from one that is only recorded (`proposed`). The field is additive: existing entity fields are
unchanged, and `status` is populated only for `DECISION` entities — other entity types omit it.
