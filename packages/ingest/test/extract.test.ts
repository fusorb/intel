import { describe, it, expect } from "vitest"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { extractRepo, collectSourceFiles } from "@fusorb/intel-ingest"

/** Build a throwaway repo tree from a path -> contents map. */
function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "intel-extract-"))
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, content)
  }
  return dir
}

describe("extractRepo skips vendored trees", () => {
  it("emits no modules or documents from vendor/", () => {
    const dir = fixture({
      "package.json": JSON.stringify({ name: "fixture" }),
      "src/index.ts": "export const a = 1\n",
      "vendor/fusorb/decisions/0001-x.md": "# X\n",
      "vendor/fusorb/content/standards/s.md": "# S\n",
      "vendor/pkg/index.ts": "export const v = 1\n",
    })

    try {
      const { packages, modules, documents } = extractRepo(dir)
      expect(packages.map((p) => p.name)).toEqual(["fixture"])
      expect(modules.map((m) => m.path)).toEqual(["src"])
      expect(documents).toEqual([])
      // The source walk skips vendor/ too.
      expect(collectSourceFiles(dir).map((f) => f.rel)).toEqual(["src/index.ts"])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
