import { describe, it, expect } from "vitest"
import { readFileSync, existsSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parseTypeScriptFile, parseFile, linkSymbols, type ParseResult, type SymbolInsertResult } from "@fusorb/intel-ingest"

const __dirname = fileURLToPath(new URL(".", import.meta.url))
const FIXTURE = resolve(__dirname, "fixtures/sample.ts")

function readFixture(): string {
  if (!existsSync(FIXTURE)) {
    throw new Error(`Fixture not found at ${FIXTURE}`)
  }
  return readFileSync(FIXTURE, "utf-8")
}

describe("parseTypeScriptFile", () => {
  it("extracts function declarations", async () => {
    const src = readFixture()
    const result = await parseTypeScriptFile(FIXTURE, src)

    const funcs = result.symbols.filter((s) => s.kind === "function")
    const names = funcs.map((s) => s.name)

    expect(names).toContain("greet")
    expect(names).toContain("asyncGreet")
    expect(names).toContain("internalHelper")
  })

  it("extracts class declarations", async () => {
    const src = readFixture()
    const result = await parseTypeScriptFile(FIXTURE, src)

    const classes = result.symbols.filter((s) => s.kind === "class")
    expect(classes.map((s) => s.name)).toContain("Greeter")
  })

  it("extracts interface declarations", async () => {
    const src = readFixture()
    const result = await parseTypeScriptFile(FIXTURE, src)

    const interfaces = result.symbols.filter((s) => s.kind === "interface")
    expect(interfaces.map((s) => s.name)).toContain("GreeterOptions")
  })

  it("extracts type alias declarations", async () => {
    const src = readFixture()
    const result = await parseTypeScriptFile(FIXTURE, src)

    const types = result.symbols.filter((s) => s.kind === "type")
    expect(types.map((s) => s.name)).toContain("GreeterResult")
  })

  it("extracts const declarations", async () => {
    const src = readFixture()
    const result = await parseTypeScriptFile(FIXTURE, src)

    const consts = result.symbols.filter((s) => s.kind === "const")
    const names = consts.map((s) => s.name)
    expect(names).toContain("DEFAULT_NAME")
    expect(names).toContain("ARROW_FN")
  })

  it("extracts enum declarations", async () => {
    const src = readFixture()
    const result = await parseTypeScriptFile(FIXTURE, src)

    const enums = result.symbols.filter((s) => s.kind === "enum")
    expect(enums.map((s) => s.name)).toContain("Status")
  })

  it("marks exported vs non-exported symbols", async () => {
    const src = readFixture()
    const result = await parseTypeScriptFile(FIXTURE, src)

    const greet = result.symbols.find((s) => s.name === "greet")
    expect(greet?.isExported).toBe(true)

    const internal = result.symbols.find((s) => s.name === "internalHelper")
    expect(internal?.isExported).toBe(false)
  })

  it("extracts source locations (line/column)", async () => {
    const src = readFixture()
    const result = await parseTypeScriptFile(FIXTURE, src)

    const greet = result.symbols.find((s) => s.name === "greet")
    expect(greet).toBeDefined()
    expect(greet!.line).toBeGreaterThan(0)
    expect(greet!.column).toBeGreaterThanOrEqual(0)
  })

  it("extracts import declarations", async () => {
    const src = readFixture()
    const result = await parseTypeScriptFile(FIXTURE, src)

    const specifiers = result.imports.map((i) => i.specifier)
    expect(specifiers).toContain("node:fs")
    expect(specifiers).toContain("react")
    expect(specifiers).toContain("node:path")
    expect(specifiers).toContain("zod")

    const reactImport = result.imports.find((i) => i.specifier === "react")
    expect(reactImport).toBeDefined()
    expect(reactImport!.names).toContain("ReactNode")
    expect(reactImport!.names).toContain("useState")
    expect(reactImport!.isDefault).toBe(true)
  })

  it("extracts export declarations", async () => {
    const src = readFixture()
    const result = await parseTypeScriptFile(FIXTURE, src)

    const exportNames = result.exports.map((e) => e.name)
    expect(exportNames).toContain("DEFAULT_GREETING")
    expect(exportNames).toContain("default")
  })

  it("captures renamed exports", async () => {
    const src = readFixture()
    const result = await parseTypeScriptFile(FIXTURE, src)

    const defaultExport = result.exports.find(
      (e) => e.isDefault && e.reExportFrom === undefined,
    )
    expect(defaultExport).toBeDefined()
  })

  it("reports no errors for valid TypeScript", async () => {
    const src = readFixture()
    const result = await parseTypeScriptFile(FIXTURE, src)
    expect(result.errors).toHaveLength(0)
  })

  it("reports errors for invalid TypeScript", async () => {
    const bad = "function { invalid syntax"
    const result = await parseTypeScriptFile("bad.ts", bad)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it("parse errors are observable — not silently swallowed as 0 symbols", async () => {
    const bad = "export function broken( { "
    const result = await parseTypeScriptFile("bad.ts", bad)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it("returns null for unsupported extensions", async () => {
    expect(await parseFile("script.py", "print('hello')")).toBeNull()
    expect(await parseFile("script.js", "console.log(42)")).toBeNull()
    expect(await parseFile("config.json", "{}")).toBeNull()
  })

  it("parses .tsx files with JSX expressions", async () => {
    const src = `
      import React from "react"
      export function Button(): string {
        return <div>Hello</div>
      }
      export class Widget { render() { return 1 } }
    `
    const result = await parseTypeScriptFile("component.tsx", src)
    const names = result.symbols.map((s) => s.name)
    expect(names).toContain("Button")
    expect(names).toContain("Widget")
  })

  it("ParseResult shape is { symbols, imports, exports, errors }", async () => {
    const src = readFixture()
    const result: ParseResult = await parseTypeScriptFile(FIXTURE, src)
    expect(result).toHaveProperty("symbols")
    expect(result).toHaveProperty("imports")
    expect(result).toHaveProperty("exports")
    expect(result).toHaveProperty("errors")
  })
})

describe("linkSymbols error observability", () => {
  it("returns parseFailed=true with errors for invalid TypeScript (no DB needed)", async () => {
    const bad = "function { invalid syntax"
    const result: SymbolInsertResult = await linkSymbols(
      "nonexistent-repo-id",
      "bad.ts",
      bad,
      "deadbeef",
    )
    expect(result.parseFailed).toBe(true)
    expect(result.count).toBe(0)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it("returns parseFailed=false, count=0, no errors for empty but valid file (no DB needed)", async () => {
    // `export {}` has 0 symbols — the upsert loop never executes, so no DB access.
    const result = await linkSymbols("nonexistent-repo-id", "empty.ts", "export {}", "deadbeef")
    expect(result.parseFailed).toBe(false)
    expect(result.count).toBe(0)
    expect(result.errors).toHaveLength(0)
  })

  it("parse errors are surfaced with file path prefix", async () => {
    const bad = "export function broken( { "
    const result = await linkSymbols("nonexistent-repo-id", "src/broken.ts", bad, "deadbeef")
    expect(result.parseFailed).toBe(true)
    expect(result.errors.some((e) => e.includes("src/broken.ts"))).toBe(true)
  })
})
