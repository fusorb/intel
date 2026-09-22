import { prisma } from "@fusorb/intel-graph"
import type { EntityType, RelationshipKind } from "@fusorb/intel-graph"

// --- Constants ---

/**
 * Stop words for keyword extraction. "fact" and "frontend" are intentionally
 * NOT in this set — they carry meaning in FUSORB domain questions
 * ("When was that fact last confirmed?" / "Facet is the single UI system").
 */
const STOP_WORDS = new Set([
  "the", "a", "an", "of", "to", "in", "on", "at", "by", "for", "with",
  "and", "or", "but", "if", "then", "when", "where", "how", "what",
  "is", "are", "was", "were", "be", "been", "being", "have", "has",
  "had", "do", "does", "did", "will", "would", "could", "should",
  "this", "that", "these", "those", "it", "its", "them", "they",
  "last", "first", "next", "previous", "recent", "earliest",
  "import", "instead", "currently", "use", "uses",
  "used", "using", "does", "can", "may", "might", "must", "shall",
  "not", "no", "nor", "just", "than", "then", "there", "here", "from",
  "into", "out", "over", "under", "also", "very", "more", "most",
  "some", "such", "about", "above", "below", "between", "during",
])

const MAX_DOCUMENT_CHARS = 4000

/** Evidence-level score multipliers. Verified facts rank first. */
function evidenceMultiplier(level: string): number {
  switch (level) {
    case "verified":
      return 1.0
    case "strongly_supported":
      return 0.8
    case "inferred":
      return 0.5
    case "unknown":
      return 0.2
    default:
      return 0.5
  }
}

// --- Types ---

export interface ProvenanceInfo {
  sourcePath: string
  sourceType: string
  sourceCommitSha: string | null
  firstSeenAt: Date
  retrievedAt: Date
  evidenceLevel: string
  removedAt: Date | null
}

export interface RetrievedEntity {
  entityType: string
  id: string
  name: string
  path: string
  description: string | null
  content: string | null
  provenance: ProvenanceInfo
  score: number
}

export interface RetrievedRelationship {
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
  provenance: ProvenanceInfo
  score: number
}

export interface RetrievedDocument {
  path: string
  repositoryName: string
  content: string | null
  provenance: ProvenanceInfo
  score: number
}

export interface RetrievalResult {
  entities: RetrievedEntity[]
  relationships: RetrievedRelationship[]
  documents: RetrievedDocument[]
}

export interface DependencyInfo {
  targetName: string
  targetRepository: string | null
  targetIsExternal: boolean
  range: string | null
  depType: string | null
  provenance: ProvenanceInfo
}

export interface PackageDependencies {
  packageName: string
  repositoryName: string
  dependencies: DependencyInfo[]
  provenance: ProvenanceInfo
}

// --- Keyword extraction ---

/**
 * Extract meaningful keywords from a free-text question.
 * Captures @scope/package tokens and individual word tokens,
 * filtering out common English stop words. Preserves domain-relevant
 * tokens like "facet" and "fact".
 */
export function extractKeywords(question: string): string[] {
  const pkgPattern = /@[\w.-]+\/[\w.-]+/g
  const packages = (question.match(pkgPattern) ?? []).map((p) => p.toLowerCase())

  const words = question.toLowerCase().match(/[a-z0-9]+/g) ?? []

  const keywords = new Set<string>()
  for (const pkg of packages) {
    keywords.add(pkg)
  }
  for (const word of words) {
    if (word.length > 2 && !STOP_WORDS.has(word)) {
      keywords.add(word)
    }
  }

  return Array.from(keywords)
}

/**
 * Compute a base score for a match, then multiply by the evidence-level
 * multiplier so verified facts rank above inferred ones.
 */
function scoreFor(evidenceLevel: string, baseScore: number): number {
  return baseScore * evidenceMultiplier(evidenceLevel)
}

/** Exact-match score (1.0 base) for names/paths equal to the keyword. */
function exactScore(evidenceLevel: string): number {
  return scoreFor(evidenceLevel, 1.0)
}

/** Substring-match score (0.5 base) for names containing the keyword. */
function substringScore(evidenceLevel: string): number {
  return scoreFor(evidenceLevel, 0.5)
}

// --- Provenance helpers ---

function extractProvenance(row: {
  sourcePath: string | null
  sourceType: string
  sourceCommitSha: string | null
  firstSeenAt: Date
  retrievedAt: Date
  evidenceLevel: string
  removedAt?: Date | null
}): ProvenanceInfo {
  return {
    sourcePath: row.sourcePath ?? "",
    sourceType: row.sourceType,
    sourceCommitSha: row.sourceCommitSha || null,
    firstSeenAt: row.firstSeenAt,
    retrievedAt: row.retrievedAt,
    evidenceLevel: row.evidenceLevel,
    removedAt: row.removedAt ?? null,
  }
}

function formatCommitSha(sha: string | null): string {
  if (!sha || sha === "") return "N/A"
  return sha.slice(0, 8)
}

function formatProvenance(p: ProvenanceInfo): string {
  const commit = formatCommitSha(p.sourceCommitSha)
  const lines = [
    `sourcePath="${p.sourcePath}"`,
    `sourceCommitSha="${commit}"`,
    `firstSeenAt="${p.firstSeenAt.toISOString()}"`,
    `retrievedAt="${p.retrievedAt.toISOString()}"`,
    `evidenceLevel="${p.evidenceLevel}"`,
  ]
  if (p.removedAt) {
    lines.push(`removedAt="${p.removedAt.toISOString()}"`)
  }
  return lines.join(", ")
}

// --- Entity name resolution ---

interface EntityRef {
  id: string
  type: string
}

/** Resolve a set of entity references to their display names. */
async function resolveEntityNames(
  refs: EntityRef[],
): Promise<Map<string, string>> {
  const byType: Record<string, string[]> = {}
  for (const ref of refs) {
    const bucket = byType[ref.type] ?? []
    bucket.push(ref.id)
    byType[ref.type] = bucket
  }

  const names = new Map<string, string>()

  for (const [type, ids] of Object.entries(byType)) {
    if (ids.length === 0) continue
    switch (type) {
      case "REPOSITORY": {
        const rows = await prisma.repository.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true },
        })
        for (const r of rows) names.set(r.id, r.name)
        break
      }
      case "PACKAGE": {
        const rows = await prisma.package.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true },
        })
        for (const p of rows) names.set(p.id, p.name)
        break
      }
      case "MODULE": {
        const rows = await prisma.module.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true },
        })
        for (const m of rows) names.set(m.id, m.name)
        break
      }
      case "DOCUMENT": {
        const rows = await prisma.document.findMany({
          where: { id: { in: ids } },
          select: { id: true, title: true, path: true },
        })
        for (const d of rows) names.set(d.id, d.title ?? d.path)
        break
      }
      case "DECISION": {
        const rows = await prisma.decision.findMany({
          where: { id: { in: ids } },
          select: { id: true, title: true },
        })
        for (const d of rows) names.set(d.id, d.title)
        break
      }
    }
  }

  return names
}

// --- Deduplication helpers ---

function dedupeEntities(entities: RetrievedEntity[]): RetrievedEntity[] {
  const seen = new Map<string, RetrievedEntity>()
  for (const e of entities) {
    const key = `${e.entityType}:${e.id}`
    const existing = seen.get(key)
    if (!existing || e.score > existing.score) {
      seen.set(key, e)
    }
  }
  return Array.from(seen.values()).sort((a, b) => b.score - a.score)
}

function dedupeRelationships(
  relationships: RetrievedRelationship[],
): RetrievedRelationship[] {
  const seen = new Map<string, RetrievedRelationship>()
  for (const r of relationships) {
    const key = r.id
    const existing = seen.get(key)
    if (!existing || r.score > existing.score) {
      seen.set(key, r)
    }
  }
  return Array.from(seen.values()).sort((a, b) => b.score - a.score)
}

function dedupeDocuments(documents: RetrievedDocument[]): RetrievedDocument[] {
  const seen = new Map<string, RetrievedDocument>()
  for (const d of documents) {
    const key = d.path
    const existing = seen.get(key)
    if (!existing || d.score > existing.score) {
      seen.set(key, d)
    }
  }
  return Array.from(seen.values()).sort((a, b) => b.score - a.score)
}

function mergeResults(target: RetrievalResult, source: RetrievalResult): void {
  target.entities.push(...source.entities)
  target.relationships.push(...source.relationships)
  target.documents.push(...source.documents)
}

// --- Exact-match retrievers ---

/**
 * Find a package by exact name across all repositories (excluding the
 * synthetic "npm" external placeholder repo).
 */
export async function searchPackage(
  name: string,
  includeExternal = false,
): Promise<RetrievedEntity[]> {
  const packages = await prisma.package.findMany({
    where: {
      name,
      removedAt: null,
      ...(includeExternal ? {} : { repository: { name: { not: "npm" } } }),
    },
    include: { repository: true },
  })

  return packages.map((p) => ({
    entityType: "PACKAGE",
    id: p.id,
    name: p.name,
    path: p.sourcePath,
    description: p.description,
    content: null,
    provenance: extractProvenance(p),
    score: exactScore(p.evidenceLevel),
    repositoryName: p.repository.name,
  }))
}

/**
 * Find a repository by exact name.
 */
export async function searchRepository(name: string): Promise<RetrievedEntity[]> {
  const repos = await prisma.repository.findMany({
    where: { name: { equals: name, mode: "insensitive" } },
  })

  return repos.map((r) => ({
    entityType: "REPOSITORY",
    id: r.id,
    name: r.name,
    path: r.name,
    description: r.url ?? null,
    content: null,
    provenance: extractProvenance(r),
    score: exactScore(r.evidenceLevel),
  }))
}

// --- Keyword search ---

export interface SearchOptions {
  /** Only return results from this repository (by name). */
  repositoryName?: string
  /** Only return results from external (npm) packages. */
  onlyExternal?: boolean
}

/**
 * Search for entities whose name, description, path, title, or content
 * contains any of the query's keywords. Falls back to substring matching
 * after exact name matching. Returns entities sorted by evidence-aware score.
 */
export async function searchContent(
  query: string,
  limit: number = 20,
  options: SearchOptions = {},
): Promise<RetrievalResult> {
  const keywords = extractKeywords(query)
  if (keywords.length === 0) {
    return { entities: [], relationships: [], documents: [] }
  }

  const result: RetrievalResult = {
    entities: [],
    relationships: [],
    documents: [],
  }

  const repoFilter = options.repositoryName
    ? { repository: { name: options.repositoryName } }
    : {}
  const externalFilter = options.onlyExternal
    ? { repository: { name: "npm" } }
    : {}

  for (const keyword of keywords) {
    // --- Exact package name match first ---
    const exactPkgs = await prisma.package.findMany({
      where: {
        name: { equals: keyword },
        removedAt: null,
        ...repoFilter,
        ...externalFilter,
      },
      include: { repository: true },
    })
    for (const p of exactPkgs) {
      result.entities.push({
        entityType: "PACKAGE",
        id: p.id,
        name: p.name,
        path: p.sourcePath,
        description: p.description,
        content: null,
        provenance: extractProvenance(p),
        score: exactScore(p.evidenceLevel),
      })
    }

    // --- Exact repository name match ---
    const exactRepos = await prisma.repository.findMany({
      where: { name: { equals: keyword, mode: "insensitive" } },
      take: limit,
    })
    for (const r of exactRepos) {
      result.entities.push({
        entityType: "REPOSITORY",
        id: r.id,
        name: r.name,
        path: r.name,
        description: r.url ?? null,
        content: null,
        provenance: extractProvenance(r),
        score: exactScore(r.evidenceLevel),
      })
    }

    // --- Substring matching for packages (non-exact) ---
    const subPackages = await prisma.package.findMany({
      where: {
        removedAt: null,
        OR: [
          { name: { contains: keyword, mode: "insensitive" } },
          { description: { contains: keyword, mode: "insensitive" } },
        ],
        NOT: { name: { equals: keyword } }, // skip exact matches already found
        ...repoFilter,
        ...externalFilter,
      },
      include: { repository: true },
      take: limit,
    })
    for (const p of subPackages) {
      result.entities.push({
        entityType: "PACKAGE",
        id: p.id,
        name: p.name,
        path: p.sourcePath,
        description: p.description,
        content: null,
        provenance: extractProvenance(p),
        score: substringScore(p.evidenceLevel),
      })
    }

    // --- Substring matching for repositories ---
    const subRepos = await prisma.repository.findMany({
      where: {
        OR: [
          { name: { contains: keyword, mode: "insensitive" } },
          { url: { contains: keyword, mode: "insensitive" } },
        ],
        NOT: { name: { equals: keyword, mode: "insensitive" } },
      },
      take: limit,
    })
    for (const r of subRepos) {
      result.entities.push({
        entityType: "REPOSITORY",
        id: r.id,
        name: r.name,
        path: r.name,
        description: r.url ?? null,
        content: null,
        provenance: extractProvenance(r),
        score: substringScore(r.evidenceLevel),
      })
    }

    // --- Substring matching for modules ---
    const modules = await prisma.module.findMany({
      where: {
        removedAt: null,
        OR: [
          { name: { contains: keyword, mode: "insensitive" } },
          { path: { contains: keyword, mode: "insensitive" } },
        ],
        ...repoFilter,
      },
      include: { repository: true },
      take: limit,
    })
    for (const m of modules) {
      result.entities.push({
        entityType: "MODULE",
        id: m.id,
        name: m.name,
        path: m.path,
        description: m.description,
        content: null,
        provenance: extractProvenance(m),
        score: substringScore(m.evidenceLevel),
      })
    }

    // --- Substring matching for documents ---
    const documents = await prisma.document.findMany({
      where: {
        removedAt: null,
        OR: [
          { title: { contains: keyword, mode: "insensitive" } },
          { description: { contains: keyword, mode: "insensitive" } },
          { content: { contains: keyword, mode: "insensitive" } },
        ],
        ...repoFilter,
      },
      include: { repository: true },
      take: limit,
    })
    for (const d of documents) {
      result.entities.push({
        entityType: "DOCUMENT",
        id: d.id,
        name: d.title ?? d.path,
        path: d.path,
        description: d.description,
        content: d.content,
        provenance: extractProvenance(d),
        score: substringScore(d.evidenceLevel),
      })
      result.documents.push({
        path: d.path,
        repositoryName: d.repository?.name ?? "unknown",
        content: d.content,
        provenance: extractProvenance(d),
        score: substringScore(d.evidenceLevel),
      })
    }

    // --- Substring matching for decisions ---
    const decisions = await prisma.decision.findMany({
      where: {
        OR: [
          { title: { contains: keyword, mode: "insensitive" } },
          { statement: { contains: keyword, mode: "insensitive" } },
        ],
      },
      take: limit,
    })
    for (const dec of decisions) {
      result.entities.push({
        entityType: "DECISION",
        id: dec.id,
        name: dec.title,
        path: dec.title,
        description: dec.statement,
        content: null,
        provenance: extractProvenance(dec),
        score: substringScore(dec.evidenceLevel),
      })
    }
  }

  result.entities = dedupeEntities(result.entities)
  result.documents = dedupeDocuments(result.documents)
  result.relationships = dedupeRelationships(result.relationships)

  return result
}

// --- Graph traversal ---

/**
 * Find all packages in a repository and their CONSUMES edges.
 * Returns packages, their dependency targets, and the CONSUMES relationships.
 */
export async function getDependencies(
  repositoryName: string,
): Promise<RetrievalResult> {
  const result: RetrievalResult = {
    entities: [],
    relationships: [],
    documents: [],
  }

  const repo = await prisma.repository.findUnique({
    where: { name: repositoryName },
    select: {
      id: true,
      name: true,
      url: true,
      defaultBranch: true,
      sourcePath: true,
      sourceType: true,
      sourceCommitSha: true,
      firstSeenAt: true,
      retrievedAt: true,
      evidenceLevel: true,
      removedAt: true,
    },
  })

  if (!repo) return result

  result.entities.push({
    entityType: "REPOSITORY",
    id: repo.id,
    name: repo.name,
    path: repo.name,
    description: repo.url ?? null,
    content: null,
    provenance: extractProvenance(repo),
    score: 1.0,
  })

  const packages = await prisma.package.findMany({
    where: { repositoryId: repo.id, removedAt: null },
    include: { repository: true },
  })

  for (const pkg of packages) {
    result.entities.push({
      entityType: "PACKAGE",
      id: pkg.id,
      name: pkg.name,
      path: pkg.sourcePath,
      description: pkg.description,
      content: null,
      provenance: extractProvenance(pkg),
      score: 0.9,
    })
  }

  const packageIds = packages.map((p) => p.id)
  if (packageIds.length === 0) return result

  const consumesEdges = await prisma.relationship.findMany({
    where: {
      fromEntityType: "PACKAGE",
      fromEntityId: { in: packageIds },
      kind: "CONSUMES",
      removedAt: null,
    },
  })

  if (consumesEdges.length === 0) return result

  const srcIds = consumesEdges.map((e) => e.fromEntityId)
  const tgtIds = consumesEdges.map((e) => e.toEntityId)
  const nameMap = await resolveEntityNames(
    [...new Set([...srcIds, ...tgtIds])].map((id) => ({
      id,
      type: "PACKAGE",
    })),
  )

  const targetPackages = await prisma.package.findMany({
    where: { id: { in: tgtIds } },
    include: { repository: true },
  })
  for (const p of targetPackages) {
    result.entities.push({
      entityType: "PACKAGE",
      id: p.id,
      name: p.name,
      path: p.sourcePath,
      description: p.description,
      content: null,
      provenance: extractProvenance(p),
      score: p.repository?.name === "npm" ? 0.5 : 0.6,
    })
  }

  for (const edge of consumesEdges) {
    result.relationships.push({
      id: edge.id,
      kind: edge.kind,
      fromId: edge.fromEntityId,
      fromType: "PACKAGE",
      fromName: nameMap.get(edge.fromEntityId) ?? edge.fromEntityId,
      toId: edge.toEntityId,
      toType: "PACKAGE",
      toName: nameMap.get(edge.toEntityId) ?? edge.toEntityId,
      note: edge.note,
      depType: edge.depType,
      provenance: extractProvenance(edge),
      score: 0.8 * evidenceMultiplier(edge.evidenceLevel),
    })
  }

  return result
}

/**
 * Find the CONSUMES edges for a specific package, identified by
 * repository name + package name. Returns resolved target info
 * (including whether each target is an external npm placeholder and the depType).
 */
export async function getPackageDependencies(
  repositoryName: string,
  packageName: string,
): Promise<PackageDependencies | null> {
  const pkg = await prisma.package.findFirst({
    where: {
      repository: { name: repositoryName },
      name: packageName,
      removedAt: null,
    },
    include: { repository: true },
  })

  if (!pkg) return null

  const edges = await prisma.relationship.findMany({
    where: {
      fromEntityId: pkg.id,
      fromEntityType: "PACKAGE",
      kind: "CONSUMES",
      removedAt: null,
    },
  })

  const targetIds = edges.map((e) => e.toEntityId)
  const targets = await prisma.package.findMany({
    where: { id: { in: targetIds } },
    include: { repository: true },
  })

  const dependencies: DependencyInfo[] = edges.map((edge) => {
    const target = targets.find((t) => t.id === edge.toEntityId)
    const targetName = target?.name ?? edge.toEntityId
    const targetRepo = target?.repository?.name ?? null
    const isExternal = targetRepo === "npm"

    return {
      targetName,
      targetRepository: targetRepo,
      targetIsExternal: isExternal,
      range: edge.note,
      depType: edge.depType,
      provenance: extractProvenance(edge),
    }
  })

  return {
    packageName: pkg.name,
    repositoryName: pkg.repository?.name ?? repositoryName,
    dependencies,
    provenance: extractProvenance(pkg),
  }
}

/**
 * Find all incoming CONSUMES edges for a package (i.e., what depends on it).
 * When repositoryName is provided, restricts to packages in that repository.
 */
export async function getDependents(
  packageName: string,
  options: { repositoryName?: string } = {},
): Promise<RetrievalResult> {
  const result: RetrievalResult = {
    entities: [],
    relationships: [],
    documents: [],
  }

  const repoWhere = options.repositoryName
    ? { repository: { name: options.repositoryName } }
    : {}

  const pkg = await prisma.package.findFirst({
    where: { name: packageName, removedAt: null, ...repoWhere },
    select: {
      id: true,
      name: true,
      sourcePath: true,
      sourceType: true,
      sourceCommitSha: true,
      firstSeenAt: true,
      retrievedAt: true,
      evidenceLevel: true,
      removedAt: true,
      repository: { select: { name: true } },
    },
  })

  if (!pkg) return result

  result.entities.push({
    entityType: "PACKAGE",
    id: pkg.id,
    name: pkg.name,
    path: pkg.sourcePath,
    description: null,
    content: null,
    provenance: extractProvenance(pkg),
    score: 0.9,
  })

  const edges = await prisma.relationship.findMany({
    where: {
      toEntityId: pkg.id,
      toEntityType: "PACKAGE",
      kind: "CONSUMES",
      removedAt: null,
    },
  })

  if (edges.length === 0) return result

  const srcIds = edges.map((e) => e.fromEntityId)
  const nameMap = await resolveEntityNames(
    srcIds.map((id) => ({ id, type: "PACKAGE" })),
  )

  const sourcePackages = await prisma.package.findMany({
    where: { id: { in: srcIds } },
    include: { repository: true },
  })
  for (const p of sourcePackages) {
    result.entities.push({
      entityType: "PACKAGE",
      id: p.id,
      name: p.name,
      path: p.sourcePath,
      description: p.description,
      content: null,
      provenance: extractProvenance(p),
      score: 0.8,
    })
  }

  for (const edge of edges) {
    result.relationships.push({
      id: edge.id,
      kind: edge.kind,
      fromId: edge.fromEntityId,
      fromType: "PACKAGE",
      fromName: nameMap.get(edge.fromEntityId) ?? edge.fromEntityId,
      toId: edge.toEntityId,
      toType: "PACKAGE",
      toName: pkg.name,
      note: edge.note,
      depType: edge.depType,
      provenance: extractProvenance(edge),
      score: 0.8 * evidenceMultiplier(edge.evidenceLevel),
    })
  }

  return result
}

// --- Relationship traversal ---

/**
 * Find all relationships connected to a specific entity, optionally
 * filtered by relationship kind. Searches both incoming and outgoing edges.
 */
export async function traverseRelationships(
  entityId: string,
  entityType: EntityType,
  kinds?: RelationshipKind[],
): Promise<RetrievedRelationship[]> {
  const kindFilter = kinds && kinds.length > 0
    ? { in: kinds as unknown as RelationshipKind[] }
    : undefined

  const edges = await prisma.relationship.findMany({
    where: {
      removedAt: null,
      OR: [
        {
          fromEntityId: entityId,
          fromEntityType: entityType,
        },
        {
          toEntityId: entityId,
          toEntityType: entityType,
        },
      ],
      ...(kindFilter ? { kind: kindFilter } : {}),
    },
  })

  const allRefs: EntityRef[] = []
  for (const e of edges) {
    allRefs.push({ id: e.fromEntityId, type: e.fromEntityType })
    allRefs.push({ id: e.toEntityId, type: e.toEntityType })
  }
  const nameMap = await resolveEntityNames(allRefs)

  const results: RetrievedRelationship[] = []
  for (const edge of edges) {
    results.push({
      id: edge.id,
      kind: edge.kind,
      fromId: edge.fromEntityId,
      fromType: edge.fromEntityType,
      fromName: nameMap.get(edge.fromEntityId) ?? edge.fromEntityId,
      toId: edge.toEntityId,
      toType: edge.toEntityType,
      toName: nameMap.get(edge.toEntityId) ?? edge.toEntityId,
      note: edge.note,
      depType: edge.depType,
      provenance: extractProvenance(edge),
      score: 0.7 * evidenceMultiplier(edge.evidenceLevel),
    })
  }

  return results.sort((a, b) => b.score - a.score)
}

// --- Document reading ---

/**
 * Read a document's full content and provenance from the graph database.
 */
export async function readDocumentContent(
  repositoryName: string,
  path: string,
): Promise<RetrievedDocument | null> {
  const doc = await prisma.document.findFirst({
    where: {
      repository: { name: repositoryName },
      path,
      removedAt: null,
    },
    include: { repository: { select: { name: true } } },
  })

  if (!doc) return null

  return {
    path: doc.path,
    repositoryName: doc.repository?.name ?? repositoryName,
    content: doc.content,
    provenance: extractProvenance(doc),
    score: 1.0,
  }
}

// --- Governance / Decision retrieval ---

/**
 * Find all Decision entities with `status: "active"`.
 * Decisions are authored explicitly (never auto-derived from repo data).
 */
export async function getActiveDecisions(): Promise<RetrievedEntity[]> {
  const decisions = await prisma.decision.findMany({
    where: { status: "active" },
  })

  return decisions.map((d) => ({
    entityType: "DECISION",
    id: d.id,
    name: d.title,
    path: d.title,
    description: d.statement,
    content: null,
    provenance: extractProvenance(d),
    score: 1.0,
  }))
}

/**
 * Find all entities currently violating active decisions. Returns the
 * violating entities and the VIOLATES edges that connect them to Decisions.
 *
 * Relationship uses polymorphic fromEntityId/toEntityId (not Prisma relations),
 * so we resolve the violating entities by querying their entity tables directly.
 */
export async function getDecisionViolations(): Promise<RetrievalResult> {
  const result: RetrievalResult = {
    entities: [],
    relationships: [],
    documents: [],
  }

  const violates = await prisma.relationship.findMany({
    where: { kind: "VIOLATES", removedAt: null },
  })

  if (violates.length === 0) return result

  const targetIds = violates.map((v) => v.toEntityId)

  // The toEntity of a VIOLATES edge is always a Decision
  const decisions = await prisma.decision.findMany({
    where: { id: { in: targetIds } },
    select: {
      id: true, title: true, statement: true, status: true,
      sourcePath: true, sourceType: true, sourceCommitSha: true,
      firstSeenAt: true, retrievedAt: true, evidenceLevel: true,
    },
  })

  // The fromEntity can be any entity type — resolve each by type
  const violatingEntities: RetrievedEntity[] = []

  const pkgSourceIds = violates
    .filter((v) => v.fromEntityType === "PACKAGE")
    .map((v) => v.fromEntityId)
  if (pkgSourceIds.length > 0) {
    const pkgs = await prisma.package.findMany({
      where: { id: { in: pkgSourceIds } },
      include: { repository: true },
    })
    for (const p of pkgs) {
      violatingEntities.push({
        entityType: "PACKAGE",
        id: p.id,
        name: p.name,
        path: p.sourcePath,
        description: p.description,
        content: null,
        provenance: extractProvenance(p),
        score: 1.0,
      })
    }
  }

  const repSourceIds = violates
    .filter((v) => v.fromEntityType === "REPOSITORY")
    .map((v) => v.fromEntityId)
  if (repSourceIds.length > 0) {
    const repos = await prisma.repository.findMany({
      where: { id: { in: repSourceIds } },
    })
    for (const r of repos) {
      violatingEntities.push({
        entityType: "REPOSITORY",
        id: r.id,
        name: r.name,
        path: r.name,
        description: r.url ?? null,
        content: null,
        provenance: extractProvenance(r),
        score: 1.0,
      })
    }
  }

  const nameMap = new Map<string, string>()
  for (const e of violatingEntities) nameMap.set(e.id, e.name)
  result.entities.push(...violatingEntities)

  for (const v of violates) {
    const decision = decisions.find((d) => d.id === v.toEntityId)
    if (!decision) continue
    result.relationships.push({
      id: v.id,
      kind: "VIOLATES",
      fromId: v.fromEntityId,
      fromType: v.fromEntityType,
      fromName: nameMap.get(v.fromEntityId) ?? v.fromEntityId,
      toId: v.toEntityId,
      toType: "DECISION",
      toName: decision.title,
      note: v.note,
      depType: null,
      provenance: extractProvenance(v),
      score: 1.0,
    })
  }

  result.entities = dedupeEntities(result.entities)
  result.relationships = dedupeRelationships(result.relationships)

  return result
}

/**
 * Find all entities governed by a specific decision (outgoing GOVERNS edges
 * from the decision). Supports traversal of governance relationships
 * deterministically before any LLM is involved.
 */
export async function getGovernedEntities(
  decisionId: string,
): Promise<RetrievalResult> {
  const result: RetrievalResult = {
    entities: [],
    relationships: [],
    documents: [],
  }

  const decision = await prisma.decision.findUnique({
    where: { id: decisionId },
    select: {
      id: true,
      title: true,
      statement: true,
      status: true,
      sourcePath: true,
      sourceType: true,
      sourceCommitSha: true,
      firstSeenAt: true,
      retrievedAt: true,
      evidenceLevel: true,
    },
  })

  if (!decision) return result

  result.entities.push({
    entityType: "DECISION",
    id: decision.id,
    name: decision.title,
    path: decision.title,
    description: decision.statement,
    content: null,
    provenance: extractProvenance(decision),
    score: 1.0,
  })

  const governed = await prisma.relationship.findMany({
    where: {
      fromEntityId: decisionId,
      kind: "GOVERNS",
      removedAt: null,
    },
  })

  if (governed.length === 0) return result

  const targetIds = governed.map((g) => g.toEntityId)
  const refs: EntityRef[] = []

  // Resolve target packages
  const pkgs = await prisma.package.findMany({
    where: { id: { in: targetIds } },
    include: { repository: true },
  })
  for (const p of pkgs) {
    refs.push({ id: p.id, type: "PACKAGE" })
    result.entities.push({
      entityType: "PACKAGE",
      id: p.id,
      name: p.name,
      path: p.sourcePath,
      description: p.description,
      content: null,
      provenance: extractProvenance(p),
      score: 0.7,
    })
  }

  const nameMap = await resolveEntityNames(refs)

  for (const g of governed) {
    result.relationships.push({
      id: g.id,
      kind: "GOVERNS",
      fromId: g.fromEntityId,
      fromType: "DECISION",
      fromName: decision.title,
      toId: g.toEntityId,
      toType: g.toEntityType,
      toName: nameMap.get(g.toEntityId) ?? g.toEntityId,
      note: g.note,
      depType: null,
      provenance: extractProvenance(g),
      score: 0.8,
    })
  }

  return result
}

// --- Main retrieval function ---

export interface RetrieveOptions {
  limit?: number
  repositoryName?: string
}

/**
 * Main entry point: retrieve graph context relevant to a natural-language question.
 *
 * Performs keyword search across all entity types, then deepens the context
 * by traversing relationships (CONSUMES, CONTAINS, etc.) from found entities.
 * Every result carries full provenance.
 */
export async function retrieve(
  question: string,
  options?: RetrieveOptions,
): Promise<RetrievalResult> {
  const limit = options?.limit ?? 50
  const result: RetrievalResult = {
    entities: [],
    relationships: [],
    documents: [],
  }

  // 1. Keyword search across all entity types
  const searchResults = await searchContent(question, limit, {
    repositoryName: options?.repositoryName,
  })
  mergeResults(result, searchResults)

  // 2. For each found repository (excluding the synthetic "npm" repo),
  //    traverse to its packages and their CONSUMES edges
  const repos = result.entities.filter(
    (e) => e.entityType === "REPOSITORY" && e.name !== "npm",
  )
  for (const repo of repos) {
    const depResult = await getDependencies(repo.name)
    mergeResults(result, depResult)
  }

  // 3. For each found package that's an external npm placeholder, find what
  //    depends on it. For internal packages, find their dependents too.
  const packages = result.entities.filter((e) => e.entityType === "PACKAGE")
  for (const pkg of packages) {
    const depResult = await getDependents(pkg.name)
    mergeResults(result, depResult)
  }

  // 4. Include active decisions and any violations
  const activeDecisions = await getActiveDecisions()
  for (const dec of activeDecisions) {
    result.entities.push(dec)
  }

  const violationResult = await getDecisionViolations()
  mergeResults(result, violationResult)

  // Deduplicate and sort by score
  result.entities = dedupeEntities(result.entities)
  result.relationships = dedupeRelationships(result.relationships)
  result.documents = dedupeDocuments(result.documents)

  return result
}

// --- Context formatting ---

/**
 * Format retrieval results as a text block suitable for inclusion in a
 * provider prompt. Every fact carries its provenance inline so the model
 * can cite it with `[source: <sourcePath>, commit: <sourceCommitSha>]`.
 *
 * The provenance line uses `sourcePath="..."` form so the citation
 * validation in the provider layer can extract and verify source paths.
 */
export function formatContext(result: RetrievalResult): string {
  const lines: string[] = []

  lines.push(
    "Below is context retrieved from the Intel knowledge graph. Each fact includes its provenance (sourcePath, sourceCommitSha, retrievedAt).",
  )
  lines.push("")

  if (result.entities.length > 0) {
    lines.push("=== Entities ===")
    lines.push("")
    for (const e of result.entities) {
      if (e.entityType === "REPOSITORY") {
        lines.push(`[Repository: ${e.name}]`)
      } else if (e.entityType === "PACKAGE") {
        const repoName = e.provenance.sourceType === "inferred_pattern"
          ? "npm (external)"
          : ""
        lines.push(`[Package: ${e.name}]${repoName ? ` (${repoName})` : ""}`)
      } else {
        lines.push(`[${e.entityType}] ${e.name}`)
      }
      if (e.description) {
        lines.push(`  description: ${e.description}`)
      }
      if (e.path) {
        lines.push(`  path: ${e.path}`)
      }
      lines.push(`  provenance: ${formatProvenance(e.provenance)}`)
      lines.push("")
    }
  }

  if (result.relationships.length > 0) {
    lines.push("=== Relationships ===")
    lines.push("")
    for (const r of result.relationships) {
      lines.push(`[${r.kind}] ${r.fromName} → ${r.toName}`)
      if (r.note) {
        lines.push(`  range: ${r.note}`)
      }
      if (r.depType) {
        lines.push(`  depType: ${r.depType}`)
      }
      lines.push(`  provenance: ${formatProvenance(r.provenance)}`)
      lines.push("")
    }
  }

  if (result.documents.length > 0) {
    lines.push("=== Documents ===")
    lines.push("")
    for (const d of result.documents) {
      lines.push(`[Document] ${d.repositoryName}/${d.path}`)
      lines.push(`  provenance: ${formatProvenance(d.provenance)}`)
      if (d.content) {
        if (d.content.length > MAX_DOCUMENT_CHARS) {
          lines.push(`  content: ${d.content.slice(0, MAX_DOCUMENT_CHARS)}...`)
          lines.push(
            `  [content truncated, full document is ${d.content.length} chars]`,
          )
        } else {
          lines.push(`  content: ${d.content}`)
        }
      }
      lines.push("")
    }
  }

  return lines.join("\n")
}
