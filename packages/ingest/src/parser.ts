/**
 * Symbol extraction boundary.
 *
 * Design:
 *   source file  →  parseTypeScriptFile()  →  ParseResult { symbols, imports, exports, errors }
 *                     ↓
 *                  linkSymbols()  →  SymbolInsertResult { count, errors, parseFailed }
 *
 * The parser uses the TypeScript compiler API via a dynamic `import("typescript")`
 * so the `typescript` package is an _optional_ dependency.  If it is not
 * installed the parser returns a ParseResult with a single error explaining
 * that the package is missing — the rest of the ingest pipeline continues to
 * work without symbols.
 *
 * Supported languages: TypeScript (.ts), TypeScript + JSX (.tsx).
 * Future expansion could add `.js` / `.jsx`, `.vue`, `.svelte` via additional
 * parser implementations behind the same `FileParser` interface.
 */

import * as path from "node:path"

import type * as ts from "typescript"

import { prisma } from "@fusorb/intel-graph"

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

/**
 * Result of inserting symbols from a file into the graph.
 *
 * `errors` contains non-fatal diagnostics (parse errors, per-symbol DB
 * hiccups).  `parseFailed` distinguishes a file that could not be parsed
 * (no symbols were attempted) from a file that parsed but had DB errors.
 */
export interface SymbolInsertResult {
  count: number
  errors: string[]
  parseFailed: boolean
}

/** Interface every language parser must implement. */
export interface FileParser {
  /** Extensions this parser handles, e.g. `[".ts", ".tsx"]`. */
  readonly extensions: string[]
  parse(filePath: string, source: string): Promise<ParseResult>
}

/* ------------------------------------------------------------------ */
/*  TypeScript / TSX parser (uses the `typescript` package)          */
/* ------------------------------------------------------------------ */

/**
 * Parse a TypeScript/TSX source file and extract all symbols, imports, and
 * exports.
 *
 * Uses a dynamic `import("typescript")` so the parser is opt-in — if the
 * package is missing, a single error is returned and the caller can decide
 * how to handle it.
 */
export async function parseTypeScriptFile(filePath: string, source: string): Promise<ParseResult> {
  const result: ParseResult = {
    symbols: [],
    imports: [],
    exports: [],
    errors: [],
  }

  // Dynamic import — `typescript` is an optional dependency.
  // ESM has no `require()`, so we `await import()` which gracefully rejects
  // when the package is absent.
  let tsMod: typeof import("typescript")
  try {
    tsMod = await import("typescript")
  } catch {
    result.errors.push("typescript package is not installed — symbol extraction skipped")
    return result
  }

  const ext = path.extname(filePath)
  const scriptKind =
    ext === ".tsx" ? tsMod.ScriptKind.TSX : ext === ".ts" ? tsMod.ScriptKind.TS : tsMod.ScriptKind.TS

  const sourceFile = tsMod.createSourceFile(
    filePath,
    source,
    tsMod.ScriptTarget.ESNext,
    /*setParentNodes*/ true,
    scriptKind,
  )

  // If `createSourceFile` reports parse diagnostics, surface them so the
  // caller can record the file as errored rather than silently producing
  // a zero-symbol result.
  // `parseDiagnostics` exists at runtime on SourceFile but is not in the
  // public TypeScript type definitions, so we use a type intersection.
  const diagSource = sourceFile as ts.SourceFile & {
    parseDiagnostics?: readonly ts.Diagnostic[]
  }
  for (const diag of diagSource.parseDiagnostics ?? []) {
    result.errors.push(
      `Parse error at line ${tsMod.getLineAndCharacterOfPosition(sourceFile, diag.start ?? 0).line + 1}: ${tsMod.flattenDiagnosticMessageText(diag.messageText, "\n")}`,
    )
  }

  const pos = (node: ts.Node) => {
    const { line, character } = tsMod.getLineAndCharacterOfPosition(sourceFile, node.pos)
    const end = tsMod.getLineAndCharacterOfPosition(sourceFile, node.end)
    return {
      line: line + 1,
      column: character,
      endLine: end.line + 1,
      endColumn: end.character,
    }
  }

  /** Collect a single symbol node if it maps to a SymbolKind. */
  function collectSymbol(node: ts.Node): void {
    let kind: SymbolKind | null = null
    let name: string | undefined

    if (tsMod.isFunctionDeclaration(node) && node.name) {
      kind = "function"
      name = node.name.text
    } else if (tsMod.isClassDeclaration(node) && node.name) {
      kind = "class"
      name = node.name.text
    } else if (tsMod.isInterfaceDeclaration(node) && node.name) {
      kind = "interface"
      name = node.name.text
    } else if (tsMod.isTypeAliasDeclaration(node) && node.name) {
      kind = "type"
      name = node.name.text
    } else if (tsMod.isEnumDeclaration(node) && node.name) {
      kind = "enum"
      name = node.name.text
    } else if (tsMod.isVariableDeclaration(node) && node.name && tsMod.isIdentifier(node.name)) {
      kind = "const"
      name = node.name.text
    }

    if (kind && name) {
      const { line, column, endLine, endColumn } = pos(node)
      // Exported = has `export` modifier.
      const modifiers = tsMod.canHaveModifiers(node)
        ? tsMod.getModifiers(node)
        : undefined
      const isExported =
        modifiers?.some((m: ts.Modifier) => m.kind === tsMod.SyntaxKind.ExportKeyword) ?? false
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

  function visit(node: ts.Node): void {
    collectSymbol(node)
    // Recurse into class bodies, function bodies, etc.
    tsMod.forEachChild(node, visit)
  }

  // Top-level visit catches declarations anywhere in the file.
  tsMod.forEachChild(sourceFile, visit)

  // --- Collect imports ---
  for (const node of sourceFile.statements) {
    if (tsMod.isImportDeclaration(node)) {
      const spec = node.moduleSpecifier
      const modulePath =
        tsMod.isStringLiteral(spec) || tsMod.isNoSubstitutionTemplateLiteral(spec)
          ? spec.text
          : spec.getText(sourceFile).replace(/['"`]/g, "")

      const importClause = node.importClause
      let isNamespace = false
      let isDefault = false
      let isTypeOnly = false
      const names: string[] = []

      if (importClause) {
        if (importClause.namedBindings) {
          if (tsMod.isNamespaceImport(importClause.namedBindings)) {
            isNamespace = true
            const b = importClause.namedBindings.name
            if (b && b.text) names.push(b.text)
          } else if (tsMod.isNamedImports(importClause.namedBindings)) {
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
    if (tsMod.isExportDeclaration(node)) {
      let modulePath: string | undefined
      if (node.moduleSpecifier) {
        if (tsMod.isStringLiteral(node.moduleSpecifier)) {
          modulePath = node.moduleSpecifier.text
        } else {
          modulePath = node.moduleSpecifier.getText(sourceFile).replace(/['"`]/g, "")
        }
      }

      if (node.exportClause) {
        if (tsMod.isNamedExports(node.exportClause)) {
          for (const el of node.exportClause.elements) {
            result.exports.push({
              name: el.name.text,
              localAlias: el.propertyName?.text,
              isDefault: el.name.text === "default",
              isWildcard: false,
              reExportFrom: modulePath,
            })
          }
        } else {
          // NamespaceExport: export * as ns [from "mod"]
          result.exports.push({
            name: "$default",
            isDefault: true,
            isWildcard: tsMod.isNamespaceExport(node.exportClause),
            reExportFrom: modulePath,
          })
        }
      } else if (node.moduleSpecifier) {
        // export * from "mod"
        result.exports.push({
          name: "*",
          isDefault: false,
          isWildcard: true,
          reExportFrom: modulePath,
        })
      }
    }
  }

  return result
}

/**
 * Dispatch parser based on file extension.
 * Returns `null` if no parser supports the extension.
 */
export async function parseFile(filePath: string, source: string): Promise<ParseResult | null> {
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
 * @returns `{ count, errors, parseFailed }` — symbols inserted, diagnostics, and whether the file failed to parse
 */
export async function linkSymbols(
  repositoryId: string,
  filePath: string,
  source: string,
  commitSha: string | null,
): Promise<SymbolInsertResult> {
  const parseResult = await parseFile(filePath, source)

  // Unsupported file type — not an error, just not TS/TSX.
  if (!parseResult) {
    return { count: 0, errors: [], parseFailed: false }
  }

  // Parse errors must NOT be silently swallowed as a zero-symbol result.
  // Surface them so the ingestion run records the failure transparently.
  if (parseResult.errors.length > 0) {
    return {
      count: 0,
      errors: parseResult.errors.map((e) => `${filePath}: ${e}`),
      parseFailed: true,
    }
  }

  const now = new Date()
  let count = 0
  const errors: string[] = []
  for (const sym of parseResult.symbols) {
    const symbolPath = `${filePath}:${sym.line}`
    try {
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
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`symbol ${sym.name} (${symbolPath}): ${msg}`)
    }
  }

  return { count, errors, parseFailed: false }
}
