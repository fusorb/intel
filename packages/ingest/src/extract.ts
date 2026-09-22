import { readdirSync, readFileSync } from "node:fs"
import type { Dirent } from "node:fs"
import { extname, join, relative, basename, sep } from "node:path"
import type { ExtractedPackage, ExtractedModule, ExtractedDocument, ExtractedRepo } from "./types.js"

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "dist-test",
  "build",
  "lib",
  "out",
  "target",
  ".next",
  ".astro",
  ".svelte-kit",
  "coverage",
  ".cache",
  ".output",
])

const SOURCE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx"])
const DOC_EXTS = new Set([".md", ".mdx", ".markdown"])

interface ScannedFile {
  abs: string
  rel: string
}

/** Walk a cloned checkout and pull out packages, modules, and documents. */
export function extractRepo(repoRoot: string): ExtractedRepo {
  const files: ScannedFile[] = []
  const sourceDirs = new Set<string>()
  const packageDirs = new Set<string>()

  walk(repoRoot, repoRoot, files, sourceDirs, packageDirs)

  const packages = files
    .filter((f) => basename(f.rel) === "package.json")
    .map((f) => parsePackage(f.rel, f.abs))
    .filter((p): p is ExtractedPackage => p !== null)

  const documents = files
    .filter((f) => DOC_EXTS.has(extname(f.rel).toLowerCase()))
    .map((f) => parseDocument(f.rel, f.abs))

  const modules = Array.from(sourceDirs)
    .filter((d) => d !== "." && !packageDirs.has(d))
    .map((d): ExtractedModule => ({
      name: basename(d) || d,
      path: d,
      description: null,
      sourcePath: d,
    }))

  return { packages, modules, documents }
}

function walk(
  root: string,
  dir: string,
  files: ScannedFile[],
  sourceDirs: Set<string>,
  packageDirs: Set<string>,
): void {
  let entries: Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  const dirRel = toRelative(root, dir)
  let hasSource = false
  let hasPackage = false
  for (const entry of entries) {
    if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue
    const abs = join(dir, entry.name)
    const rel = toRelative(root, abs)
    if (entry.isDirectory()) {
      walk(root, abs, files, sourceDirs, packageDirs)
    } else if (entry.isFile()) {
      files.push({ abs, rel })
      if (SOURCE_EXTS.has(extname(entry.name).toLowerCase())) hasSource = true
      if (entry.name === "package.json") hasPackage = true
    }
  }
  if (hasSource) sourceDirs.add(dirRel)
  if (hasPackage) packageDirs.add(dirRel)
}

function toRelative(root: string, abs: string): string {
  const r = relative(root, abs).split(sep).join("/")
  return r === "" ? "." : r
}

function parsePackage(relPath: string, absPath: string): ExtractedPackage | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(absPath, "utf-8"))
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null
  const name = stringField(parsed, "name")
  if (!name) return null
  return {
    name,
    version: stringField(parsed, "version"),
    description: stringField(parsed, "description"),
    dependencies: dependencyMap(parsed["dependencies"]),
    devDependencies: dependencyMap(parsed["devDependencies"]),
    peerDependencies: dependencyMap(parsed["peerDependencies"]),
    optionalDependencies: dependencyMap(parsed["optionalDependencies"]),
    sourcePath: relPath,
  }
}

function parseDocument(relPath: string, absPath: string): ExtractedDocument {
  let text: string
  try {
    text = readFileSync(absPath, "utf-8")
  } catch {
    return {
      title: null,
      path: relPath,
      description: null,
      content: null,
      sourcePath: relPath,
    }
  }
  return {
    title: basename(relPath, extname(relPath)) || null,
    path: relPath,
    description: firstLine(text, 240),
    content: text,
    sourcePath: relPath,
  }
}

function firstLine(text: string, max: number): string | null {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed) return trimmed.slice(0, max)
  }
  return null
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v)
}

function stringField(obj: Record<string, unknown>, key: string): string | null {
  const value = obj[key]
  return typeof value === "string" ? value : null
}

function dependencyMap(v: unknown): Record<string, string> | null {
  if (!isRecord(v)) return null
  const map: Record<string, string> = {}
  for (const [key, value] of Object.entries(v)) {
    map[key] = typeof value === "string" ? value : String(value)
  }
  return map
}
