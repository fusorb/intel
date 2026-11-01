export type {
  IngestSummary,
  ExtractedPackage,
  ExtractedModule,
  ExtractedDocument,
  ExtractedRepo,
} from "./types.js"
export { ingestRepo } from "./ingest.js"
export {
  markStale,
  upsertRepository,
  upsertPackage,
  upsertModule,
  upsertDocument,
  linkContains,
  linkConsumes,
  linkGoverns,
  linkViolates,
  upsertDecision,
  syncPackageConsumes,
  startIngestionRun,
  completeIngestionRun,
  provenance,
} from "./graph.js"
export type { ProvLevel, ProvSourceType, ProvenanceFields, DecisionUpsertInput } from "./graph.js"
export { runGovernance, detectViolations } from "./governance.js"
export type { GovernanceSummary } from "./governance.js"
export { ECOSYSTEM_DECISIONS } from "./decisions.js"
export type { DecisionSeed, DecisionTarget } from "./decisions.js"
export {
  parseTypeScriptFile,
  parseFile,
  linkSymbols,
} from "./parser.js"
export type {
  SymbolKind,
  SymbolInfo,
  ImportInfo,
  ExportInfo,
  ParseResult,
  SymbolInsertResult,
  FileParser,
} from "./parser.js"
export { repositoryNameFromUrl, cloneOrFetch, currentCommit, defaultBranch, AGENT_REPOS } from "./git.js"
