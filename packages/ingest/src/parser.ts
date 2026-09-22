/**
 * Symbol extraction boundary.
 *
 * Design:
 *   source file  →  parseTypeScriptFile()  →  ParseResult { symbols, imports, exports, errors }
 *                     ↓
 *                  linkSymbolsToModule()  →  Symbol[] + DEFINES / EXPORTS / REFERENCES / DEPENDS_ON edges
 *
 * The parser uses the TypeScript compiler API (`import("typescript")`) as a
 * dynamic import, making it an _optional_ dependency.  If `typescript` is not
 * installed the parser returns a ParseResult with a single error explaining
 * that the package is missing — the rest of the ingest pipeline continues to
 * work without symbols.
 *
 * Supported languages: TypeScript (.ts), TypeScript + JSX (.tsx).
 * Future expansion could add `.js` / `.jsx`, `.vue`, `.svelte` via additional
 * parser implementations behind the same `FileParser` interface.
 */

import * as path from "node:path"
import { createRequire } from "node:module"
import { prisma } from "@fusorb/intel-graph"

const require = createRequire(import.meta.url)

/** Kinds of symbols the parser can extract from source. */
export type SymbolKind =
  | "function"
  | "class"
  | "interface"
  | "type"
  | "const"
  | "enum"
  | "variable"
  | "method"
  | "property"
  | "parameter"

/** A symbol extracted from a source file. */
export interface SymbolInfo {
  /** Unqualified name, e.g. `Foo`, `<anonymous>`, or the default-export sentinel `$default`. */
  name: string
  kind: SymbolKind
  /** 1-based line number where the symbol starts. */
  line: number
  /** 0-based column number where the symbol starts. */
  column: number
  /** 1-based line number where the symbol ends (optional). */
  endLine?: number
  /** 0-based column number where the symbol ends (optional). */
  endColumn?: number
  /** Whether the symbol is reachable outside the module via an export. */
  isExported: boolean
}

/** An import declaration extracted from a source file. */
export interface ImportInfo {
  /** Module specifier, e.g. `"react"` or `"./utils"` (no quotes). */
  specifier: string
  /** Named bindings, e.g. `["useState", "useEffect"]`. */
  names: string[]
  /** `*` for namespace imports, `default` for default imports. */
  isNamespace: boolean
  isDefault: boolean
  /** Whether this is a type-only import. */
  isTypeOnly: boolean
}

/** A named export extracted from a source file. */
export interface ExportInfo {
  /** Local name of the export. */
  name: string
  /** Renamed alias if different from `name`, otherwise `undefined`. */
  localAlias?: string
  /** `true` for `export default` (name is `"$default"`). */
  isDefault: boolean
  /** `true` for `export *` re-exports. */
  isWildcard: boolean
  /** Target if this is a re-export (`export { foo } from "bar"`). */
  reExportFrom?: string
}

/** Result of parsing a single source file. */
export interface ParseResult {
  /** Every top-level symbol found in the file. */
  symbols: SymbolInfo[]
  /** Every import declaration. */
  imports: ImportInfo[]
  /** Every export declaration. */
  exports: ExportInfo[]
  /** Human-readable parse errors (if any). */
  errors: string[]
}

/** Interface every language parser must implement. */
export interface FileParser {
  /** Extensions this parser handles, e.g. `[".ts", ".tsx"]`. */
  readonly extensions: string[]
  parse(filePath: string, source: string): ParseResult
}

/* ------------------------------------------------------------------ */
/*  TypeScript / TSX parser (uses the `typescript` package)          */
/* ------------------------------------------------------------------ */

// Minimal node type — `typescript` is an optional dependency so we don't
// reference its full type namespace; we treat nodes as opaque and access
// only the properties we need at runtime through the `ts` module.
type TsNode = {
  pos: number
  end: number
  kind: number
  name?: { text: string }
}

/**
 * Parse a TypeScript/TSX source file and extract all symbols.
 *
 * Uses a dynamic import of `typescript` so the parser is opt-in.
 * If the package is missing, a single error is returned and the caller
 * can decide how to handle it.
 */
export function parseTypeScriptFile(filePath: string, source: string): ParseResult {
  const result: ParseResult = {
    symbols: [],
    imports: [],
    exports: [],
    errors: [],
  }

  let ts: any
  try {
    ts = require("typescript")
  } catch {
    result.errors.push(
      "typescript package is not installed — symbol extraction skipped",
    )
    return result
  }

  const ext = path.extname(filePath)
  const scriptKind =
    ext === ".tsx" ? ts.ScriptKind.TSX : ext === ".ts" ? ts.ScriptKind.TS : ts.ScriptKind.TS

  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.ESNext,
    /*setParentNodes*/ true,
    scriptKind,
  )

  // If `createSourceFile` reports parse diagnostics, surface them.
  for (const diag of sourceFile.parseDiagnostics ?? []) {
    result.errors.push(
      `Parse error at line ${ts.getLineAndCharacterOfPosition(sourceFile, diag.start ?? 0).line + 1}: ${ts.flattenDiagnosticMessageText(diag.messageText, "\n")}`,
    )
  }

  const pos = (node: TsNode) => {
    const { line, character } = ts.getLineAndCharacterOfPosition(sourceFile, node.pos)
    const end = ts.getLineAndCharacterOfPosition(sourceFile, node.end)
    return {
      line: line + 1,
      column: character,
      endLine: end.line + 1,
      endColumn: end.character,
    }
  }

  /** Collect a single symbol node if it maps to a SymbolKind. */
  function collectSymbol(node: TsNode): void {
    let kind: SymbolKind | null = null
    let name: string | undefined

    if (ts.isFunctionDeclaration(node) && node.name) {
      kind = "function"
      name = node.name.text
    } else if (ts.isClassDeclaration(node) && node.name) {
      kind = "class"
      name = node.name.text
    } else if (ts.isInterfaceDeclaration(node) && node.name) {
      kind = "interface"
      name = node.name.text
    } else if (ts.isTypeAliasDeclaration(node) && node.name) {
      kind = "type"
      name = node.name.text
    } else if (ts.isEnumDeclaration(node) && node.name) {
      kind = "enum"
      name = node.name.text
    } else if (ts.isVariableDeclaration(node) && node.name && ts.isIdentifier(node.name)) {
      kind = "const"
      name = node.name.text
    }

    if (kind && name) {
      const { line, column, endLine, endColumn } = pos(node)
      // Exported = has `export` modifier.
      const modifiers = ts.canHaveModifiers(node)
        ? ts.getModifiers(node)
        : undefined
      const isExported = modifiers?.some(
        (m: TsNode) => m.kind === ts.SyntaxKind.ExportKeyword,
      ) ?? false
      result.symbols.push({
        name,
        kind,
        line,
        column,
        endLine,
        endColumn,
        isExported,
      })
    }
  }

  function visit(node: TsNode): void {
    collectSymbol(node)
    // Recurse into class bodies, function bodies, etc.
    ts.forEachChild(node, visit)
  }

  // Top-level visit catches declarations anywhere in the file.
  ts.forEachChild(sourceFile, visit)

  // --- Collect imports ---
  for (const node of sourceFile.statements) {
    if (ts.isImportDeclaration(node)) {
      const spec = node.moduleSpecifier
      const modulePath =
        ts.isStringLiteral(spec) || ts.isNoSubstitutionTemplateLiteral(spec)
          ? spec.text
          : spec.getText(sourceFile).replace(/['"`]/g, "")

      const importClause = node.importClause
      let isNamespace = false
      let isDefault = false
      let isTypeOnly = false
      const names: string[] = []

      if (importClause) {
        if (importClause.namedBindings) {
          if (ts.isNamespaceImport(importClause.namedBindings)) {
            isNamespace = true
            const b = importClause.namedBindings.name as TsNode
            if (b) names.push(b.text)
          } else if (ts.isNamedImports(importClause.namedBindings)) {
            for (const el of importClause.namedBindings.elements) {
              names.push(el.name.text)
              if (el.isTypeOnly) isTypeOnly = true
            }
          }
        }
        if (importClause.name) {
          isDefault = true
          isTypeOnly = importClause.isTypeOnly ?? false
          names.push(importClause.name.text)
        }
      }

      result.imports.push({
        specifier: modulePath,
        names,
        isNamespace,
        isDefault,
        isTypeOnly,
      })
    }
  }

  // --- Collect exports ---
  for (const node of sourceFile.statements) {
    if (ts.isExportDeclaration(node)) {
      if (node.exportClause) {
        if (ts.isNamedExports(node.exportClause)) {
          for (const el of node.exportClause.elements) {
            result.exports.push({
              name: el.name.text,
              localAlias: el.propertyName?.text,
              isDefault: el.name.text === "default",
              isWildcard: false,
              reExportFrom: node.moduleSpecifier
                ? (ts.isStringLiteral(node.moduleSpecifier)
                    ? node.moduleSpecifier.text
                    : node.moduleSpecifier.getText(sourceFile).replace(/['"`]/g, ""))
                : undefined,
            })
          }
        } else {
          // export * from "mod" or export { default }
          const name = ts.isArrayLiteralNode(node.exportClause)
            ? (node.exportClause.elements[0] as TsNode)?.name?.text ?? "$default"
            : "$default"
          result.exports.push({
            name,
            isDefault: true,
            isWildcard: ts.isNamespaceExport(node.exportClause),
            reExportFrom: node.moduleSpecifier
              ? (ts.isStringLiteral(node.moduleSpecifier)
                  ? node.moduleSpecifier.text
                  : node.moduleSpecifier.getText(sourceFile).replace(/['"`]/g, ""))
              : undefined,
          })
        }
      } else {
        // export * from "mod"
        if (node.moduleSpecifier) {
          const mod = ts.isStringLiteral(node.moduleSpecifier)
            ? node.moduleSpecifier.text
            : node.moduleSpecifier.getText(sourceFile).replace(/['"`]/g, "")
          result.exports.push({ name: "*", isDefault: false, isWildcard: true, reExportFrom: mod })
        }
      }
    }
  }

  return result
}

/**
 * Dispatch parser based on file extension.
 * Returns `null` if no parser supports the extension.
 */
export function parseFile(filePath: string, source: string): ParseResult | null {
  const ext = path.extname(filePath)
  if (ext === ".ts" || ext === ".tsx") {
    return parseTypeScriptFile(filePath, source)
  }
  return null
}

/* ------------------------------------------------------------------ */
/*  Linking — wire parsed symbols into the graph                        */
/* ------------------------------------------------------------------ */

/**
 * Insert symbols from a parsed file into the graph.
 *
 * The symbol is keyed on `[repositoryId, path, name]` where `path` is
 * `"<filePath>:<line>"` — matching the schema's `@@unique([repositoryId, path, name])`.
 *
 * Relationship wiring (DEFINES / EXPORTS / REFERENCES / DEPENDS_ON) is
 * deferred to a future pass.  This function only creates Symbol rows so
 * ingestion can be convergent (re-running overwrites same-name symbols).
 *
 * @param repositoryId — database ID of the Repository that owns this file
 * @param filePath     — sourcePath for provenance
 * @param source       — raw file text
 * @param commitSha    — commit SHA for provenance
 * @returns the number of symbols inserted
 */
export async function linkSymbols(
  repositoryId: string,
  filePath: string,
  source: string,
  commitSha: string | null,
): Promise<number> {
  const parseResult = parseFile(filePath, source)
  if (!parseResult || parseResult.errors.length > 0) {
    return 0
  }

  const now = new Date()
  let count = 0
  for (const sym of parseResult.symbols) {
    const symbolPath = `${filePath}:${sym.line}`
    await prisma.symbol.upsert({
      where: {
        repositoryId_path_name: {
          repositoryId,
          path: symbolPath,
          name: sym.name,
        },
      },
      create: {
        repositoryId,
        name: sym.name,
        kind: sym.kind,
        path: symbolPath,
        sourcePath: filePath,
        sourceCommitSha: commitSha,
        retrievedAt: now,
        evidenceLevel: "verified",
        sourceType: "file",
      },
      update: {
        kind: sym.kind,
        sourcePath: filePath,
        sourceCommitSha: commitSha,
        retrievedAt: now,
        evidenceLevel: "verified",
        sourceType: "file",
        removedAt: null,
      },
    })
    count++
  }

  return count
}
