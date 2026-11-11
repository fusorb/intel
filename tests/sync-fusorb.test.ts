import { describe, it, expect } from "vitest"
import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, cpSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

// This test gates the tool that gates CI: tools/consumer/sync-fusorb.mjs runs
// `pnpm check:fusorb` in the `ci` workflow. It exercises the checker without
// ever mutating the committed vendor/fusorb snapshot.

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const script = join(repoRoot, "tools", "consumer", "sync-fusorb.mjs")

function runCheck(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [script, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  })
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" }
}

describe("sync-fusorb check", () => {
  it("passes the vendored intel profile", () => {
    const r = runCheck(["--check", "--profile", "intel"])
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("check:sync: OK")
  })

  it("fails on an unknown profile", () => {
    const r = runCheck(["--check", "--profile", "no-such-profile"])
    expect(r.status).toBe(1)
  })

  it("fails when a source tree diverges from the vendored snapshot", () => {
    const profiles = JSON.parse(
      readFileSync(join(repoRoot, "tools", "consumer", "profiles.json"), "utf8"),
    ) as { profiles: Record<string, { files: Array<{ src: string; dst: string }> }> }
    const files = profiles.profiles.intel!.files
    const first = files[0]!
    const tmp = mkdtempSync(join(tmpdir(), "sync-fusorb-"))

    try {
      // Mirror the vendored files back into a temp source tree (vendor dst -> src).
      for (const f of files) {
        const src = join(repoRoot, "vendor", "fusorb", f.dst)
        const dst = join(tmp, f.src)
        mkdirSync(dirname(dst), { recursive: true })
        cpSync(src, dst)
      }
      // Introduce a single-byte divergence in one source file.
      const mutated = join(tmp, first.src)
      writeFileSync(mutated, readFileSync(mutated, "utf8") + "\n// drift\n")

      const r = runCheck(["--check", "--profile", "intel", "--from", tmp])
      expect(r.status).toBe(1)
      expect(r.stderr).toContain("source differs from vendored copy")
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})
