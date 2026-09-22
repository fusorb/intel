import { prisma } from "@fusorb/intel-graph"
import type { EntityType, RelationshipKind } from "@fusorb/intel-graph"

// --- Constants ---

const STOP_WORDS = new Set([
  "the", "a", "an", "of", "to", "in", "on", "at", "by", "for", "with",
  "and", "or", "but", "if", "then", "when", "where", "how", "what",
  "is", "are", "was", "were", "be", "been", "being", "have", "has",
  "had", "do", "does", "did", "will", "would", "could", "should",
  "this", "that", "these", "those", "it", "its", "them", "they",
  "import", "frontend", "instead", "fact", "confirmed",
])

const MAX_DOCUMENT_CHARS = 4000

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
 * filtering out common English stop words.
 */
export function extractKeywords(question: string): string[] {
  const pkgPattern = /@[\w.-]+\/[\w.-]+/g
  const packages = question.match(pkgPattern) ?? []

  const words = question.toLowerCase().match(/[a-z0-9]+/g) ?? []

  const keywords = new Set<string>()
  for (const pkg of packages) {
    keywords.add(pkg.toLowerCase())
  }
  for (const word of words) {
    if (word.length > 2 && !STOP_WORDS.has(word)) {
      keywords.add(word)
    }
  }

  return Array.from(keywords)
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
  return `sourcePath="${p.sourcePath}", sourceCommitSha="${commit}", retrievedAt="${p.retrievedAt.toISOString()}", evidenceLevel="${p.evidenceLevel}"`
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
  return Array.from(seen.values())
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
  return Array.from(seen.values())
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
  return Array.from(seen.values())
}

function mergeResults(target: RetrievalResult, source: RetrievalResult): void {
  target.entities.push(...source.entities)
  target.relationships.push(...source.relationships)
  target.documents.push(...source.documents)
}

// --- Keyword search ---

/**
 * Search for entities whose name, description, path, title, or content
 * contains any of the query's keywords. Returns entities with provenance.
 */
export async function searchContent(
  query: string,
  limit: number = 20,
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

  for (const keyword of keywords) {
    // Search repositories by name and URL
    const repos = await prisma.repository.findMany({
      where: {
        OR: [
          { name: { contains: keyword, mode: "insensitive" } },
          { url: { contains: keyword, mode: "insensitive" } },
        ],
      },
      take: limit,
    })
    for (const r of repos) {
      result.entities.push({
        entityType: "REPOSITORY",
        id: r.id,
        name: r.name,
        path: r.name,
        description: r.url ?? null,
        content: null,
        provenance: extractProvenance(r),
        score: keyword.length > 5 ? 0.9 : 0.7,
      })
    }

    // Search packages by name and description
    const packages = await prisma.package.findMany({
      where: {
        removedAt: null,
        OR: [
          { name: { contains: keyword, mode: "insensitive" } },
          { description: { contains: keyword, mode: "insensitive" } },
        ],
      },
      include: { repository: true },
      take: limit,
    })
    for (const p of packages) {
      result.entities.push({
        entityType: "PACKAGE",
        id: p.id,
        name: p.name,
        path: p.sourcePath,
        description: p.description,
        content: null,
        provenance: extractProvenance(p),
        score: keyword.length > 5 ? 0.9 : 0.7,
      })
    }

    // Search modules by name and path
    const modules = await prisma.module.findMany({
      where: {
        removedAt: null,
        OR: [
          { name: { contains: keyword, mode: "insensitive" } },
          { path: { contains: keyword, mode: "insensitive" } },
        ],
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
        score: keyword.length > 5 ? 0.8 : 0.6,
      })
    }

    // Search documents by title, description, and content
    const documents = await prisma.document.findMany({
      where: {
        removedAt: null,
        OR: [
          { title: { contains: keyword, mode: "insensitive" } },
          { description: { contains: keyword, mode: "insensitive" } },
          { content: { contains: keyword, mode: "insensitive" } },
        ],
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
        score: keyword.length > 5 ? 0.8 : 0.6,
      })
      result.documents.push({
        path: d.path,
        repositoryName: d.repository?.name ?? "unknown",
        content: d.content,
        provenance: extractProvenance(d),
        score: keyword.length > 5 ? 0.8 : 0.6,
      })
    }

    // Search decisions by title and statement
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
        score: 0.8,
      })
    }
  }

  result.entities = dedupeEntities(result.entities)
  result.documents = dedupeDocuments(result.documents)

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

  // Find all packages belonging to this repository
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

  // Find all CONSUMES edges from these packages
  const consumesEdges = await prisma.relationship.findMany({
    where: {
      fromEntityType: "PACKAGE",
      fromEntityId: { in: packageIds },
      kind: "CONSUMES",
      removedAt: null,
    },
  })

  if (consumesEdges.length === 0) return result

  // Resolve source and target package names
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
  const targetRepoMap = new Map<string, string>()
  for (const p of targetPackages) {
    targetRepoMap.set(p.id, p.repository?.name ?? "unknown")
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
      provenance: extractProvenance(edge),
      score: 0.8,
    })
  }

  return result
}

/**
 * Find the CONSUMES edges for a specific package, identified by
 * repository name + package name. Returns resolved target info
 * (including whether each target is an external npm placeholder).
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
 */
async function getDependents(
  packageName: string,
): Promise<RetrievalResult> {
  const result: RetrievalResult = {
    entities: [],
    relationships: [],
    documents: [],
  }

  const pkg = await prisma.package.findFirst({
    where: { name: packageName, removedAt: null },
    select: { id: true, name: true, sourcePath: true, sourceType: true, sourceCommitSha: true, firstSeenAt: true, retrievedAt: true, evidenceLevel: true, removedAt: true, repository: { select: { name: true } } },
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
      provenance: extractProvenance(edge),
      score: 0.8,
    })
  }

  return result
}

// -- Relationship traversal (bidirectional, for structural questions) --

/**
 * Find all relationships connected to a specific entity, optionally
 * filtered by relationship kind. Searches both incoming and outgoing edges.
 */
export async function traverseRelationships(
  entityId: string,
  entityType: EntityType,
  kinds?: RelationshipKind[],
): Promise<RetrievedRelationship[]> {
  const kindFilter = kinds && kinds.length > 0 ? { in: kinds } : undefined

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
      fromName: nameMap.get(`${edge.fromEntityId}`) ?? edge.fromEntityId,
      toId: edge.toEntityId,
      toType: edge.toEntityType,
      toName: nameMap.get(`${edge.toEntityId}`) ?? edge.toEntityId,
      note: edge.note,
      provenance: extractProvenance(edge),
      score: 0.7,
    })
  }

  return results
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

// --- Main retrieval function ---

export interface RetrieveOptions {
  limit?: number
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
  const searchResults = await searchContent(question, limit)
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

  // 3. For each found package, find incoming CONSUMES edges
  //    (i.e., what depends on this package). This is how we discover
    // the SovGrant → @arcevo/facet-sdk edge when the user mentions the
    // package name directly.
  const packages = result.entities.filter((e) => e.entityType === "PACKAGE")
  for (const pkg of packages) {
    if (pkg.provenance.sourceType === "inferred_pattern") {
      // This is an npm placeholder — find what depends on it
      const depResult = await getDependents(pkg.name)
      mergeResults(result, depResult)
    }
  }

  // Deduplicate
  result.entities = dedupeEntities(result.entities)
  result.relationships = dedupeRelationships(result.relationships)
  result.documents = dedupeDocuments(result.documents)

  return result
}

// --- Context formatting ---

/**
 * Format retrieval results as a text block suitable for inclusion in a
 * provider prompt. Every fact carries its provenance inline so the model
 * can cite it.
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
      lines.push(`[${e.entityType}] ${e.name}`)
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
      lines.push(`  provenance: ${formatProvenance(r.provenance)}`)
      lines.push("")
    }
  }

  if (result.documents.length > 0) {
    lines.push("=== Documents ===")
    lines.push("")
    for (const d of result.documents) {
      lines.push(`[Document] ${d.path}`)
      lines.push(`  provenance: ${formatProvenance(d.provenance)}`)
      if (d.content) {
        if (d.content.length > MAX_DOCUMENT_CHARS) {
          lines.push(`  content: ${d.content.slice(0, MAX_DOCUMENT_CHARS)}...`)
          lines.push(`  [content truncated, full document is ${d.content.length} chars]`)
        } else {
          lines.push(`  content: ${d.content}`)
        }
      }
      lines.push("")
    }
  }

  return lines.join("\n")
}
