/** Entity shapes extracted from a cloned repository before they are typed into the graph. */

export interface ExtractedPackage {
  name: string
  version: string | null
  description: string | null
  dependencies: Record<string, string> | null
  devDependencies: Record<string, string> | null
  peerDependencies: Record<string, string> | null
  optionalDependencies: Record<string, string> | null
  sourcePath: string
}

export interface ExtractedModule {
  name: string
  path: string
  description: string | null
  sourcePath: string
}

export interface ExtractedDocument {
  title: string | null
  path: string
  description: string | null
  content: string | null
  sourcePath: string
}

export interface ExtractedRepo {
  packages: ExtractedPackage[]
  modules: ExtractedModule[]
  documents: ExtractedDocument[]
}

export interface IngestSummary {
  repo: string
  commitSha: string
  branch: string | null
  packages: number
  modules: number
  documents: number
  consumesEdges: number
  containsEdges: number
}
