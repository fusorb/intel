import { describe, it, expect } from "vitest"
import { spawnSync, execFileSync } from "node:child_process"
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  rmSync,
  cpSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { resolve, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

// This test gates the tool that gates CI: tools/consumer/sync-fusorb.mjs runs
// `pnpm check:fusorb` in the `ci` workflow. It exercises both modes without ever
// mutating the committed vendor/fusorb snapshot:
//   * offline `--check` proves the vendored tree matches PROVENANCE.json,
//   * `--check --from <source>` additionally proves freshness against the source
//     repo (commit drift, unvendored source files, byte drift).

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const script = join(repoRoot, "tools", "consumer", "sync-fusorb.mjs")
const vendorRoot = join(repoRoot, "vendor", "fusorb")

type ProfileEntry = { src?: string; dst?: string; srcDir?: string; dstDir?: string }
type Profile = { files: ProfileEntry[] }

function intelEntries(): ProfileEntry[] {
  const profiles = JSON.parse(
    readFileSync(join(repoRoot, "tools", "consumer", "profiles.json"), "utf8"),
  ) as { profiles: Record<string, Profile> }
  return profiles.profiles.intel!.files
}

function provenance(): { sourceCommit: string; files: Array<{ path: string; sha256: string }> } {
  return JSON.parse(readFileSync(join(vendorRoot, "PROVENANCE.json"), "utf8"))
}

/** Relative paths of every file under `dir`, using "/" separators. */
function listFiles(dir: string, base = dir): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    const rel = full.slice(base.length + 1).split("\\").join("/")
    if (entry.isDirectory()) out.push(...listFiles(full, base))
    else if (entry.isFile()) out.push(rel)
  }
  return out
}

/** Mirror the profile's expansion of the vendored tree back into a source tree. */
function expandAgainstVendor(entries: ProfileEntry[]): Array<{ src: string; dst: string }> {
  const out: Array<{ src: string; dst: string }> = []
  const seen = new Set<string>()
  for (const entry of entries) {
    if (entry.srcDir && entry.dstDir) {
      for (const rel of listFiles(join(vendorRoot, entry.dstDir))) {
        const dst = `${entry.dstDir}/${rel}`
        if (seen.has(dst)) continue
        seen.add(dst)
        out.push({ src: `${entry.srcDir}/${rel}`, dst })
      }
    } else if (entry.src && entry.dst) {
      if (seen.has(entry.dst)) continue
      seen.add(entry.dst)
      out.push({ src: entry.src, dst: entry.dst })
    }
  }
  return out
}

function writeHead(dir: string, sha: string): void {
  // A bare `.git/HEAD` is not enough for git to treat `dir` as a repository, so
  // initialise a real one and point HEAD at the sha we want. The object itself
  // need not exist: rev-parse only resolves the ref.
  execFileSync("git", ["init", "-q", dir])
  writeFileSync(join(dir, ".git", "HEAD"), sha)
}

/**
 * Build a temp source tree that mirrors the vendored snapshot, with a git HEAD
 * equal to the vendored source commit, so freshness checks pass by default.
 */
function mirrorSource(commitSha: string): { tmp: string; files: Array<{ src: string; dst: string }> } {
  const files = expandAgainstVendor(intelEntries())
  const tmp = mkdtempSync(join(tmpdir(), "sync-fusorb-"))
  for (const f of files) {
    const src = join(vendorRoot, f.dst)
    const dst = join(tmp, f.src)
    mkdirSync(dirname(dst), { recursive: true })
    cpSync(src, dst)
  }
  writeHead(tmp, commitSha)
  return { tmp, files }
}

function runCheck(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [script, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  })
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" }
}

describe("sync-fusorb profiles", () => {
  it("resolves the intel profile to exactly the vendored file set", () => {
    // Guards the directory entries: decisions/, content/standards/ and scripts/lib/
    // must expand to the same files the snapshot holds.
    const expanded = expandAgainstVendor(intelEntries()).map((f) => f.dst)
    const manifest = provenance().files.map((f) => f.path)
    expect([...expanded].sort()).toEqual([...manifest].sort())
  })
})

describe("sync-fusorb check", () => {
  it("passes the vendored intel profile offline", () => {
    const r = runCheck(["--check", "--profile", "intel"])
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("check:sync: OK")
  })

  it("fails on an unknown profile", () => {
    const r = runCheck(["--check", "--profile", "no-such-profile"])
    expect(r.status).toBe(1)
  })

  it("fails loudly when --from-env names an unset variable", () => {
    const r = runCheck(["--check", "--profile", "intel", "--from-env", "SYNC_FUSORB_UNSET_VAR"])
    expect(r.status).toBe(1)
    expect(r.stderr).toContain("is not set to a repo path")
  })

  it("passes freshness against a source tree at the vendored commit", () => {
    const { tmp } = mirrorSource(provenance().sourceCommit)
    try {
      const r = runCheck(["--check", "--profile", "intel", "--from", tmp])
      expect(r.stderr).toBe("")
      expect(r.status).toBe(0)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it("passes freshness for composed profiles whose files are all vendored", () => {
    const { tmp } = mirrorSource(provenance().sourceCommit)
    try {
      const r = runCheck(["--check", "--profile", "intel,names", "--from", tmp])
      expect(r.stderr).toBe("")
      expect(r.status).toBe(0)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it("fails on commit drift when the source HEAD moved", () => {
    const { tmp } = mirrorSource("1111111111111111111111111111111111111111")
    try {
      const r = runCheck(["--check", "--profile", "intel", "--from", tmp])
      expect(r.status).toBe(1)
      expect(r.stderr).toContain("stale sync")
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it("fails when a profiled source file differs from the vendored copy", () => {
    const { tmp } = mirrorSource(provenance().sourceCommit)
    try {
      const mutated = join(tmp, "decisions", "0001-role-and-boundary.md")
      writeFileSync(mutated, readFileSync(mutated, "utf8") + "\n<!-- drift -->\n")

      const r = runCheck(["--check", "--profile", "intel", "--from", tmp])
      expect(r.status).toBe(1)
      expect(r.stderr).toContain("source differs from vendored copy")
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it("fails when a source file is not vendored, so a new ADR cannot slip through", () => {
    const { tmp } = mirrorSource(provenance().sourceCommit)
    try {
      writeFileSync(join(tmp, "decisions", "0010-a-new-decision.md"), "# 10. New\n\n## Decision\n\nx\n")

      const r = runCheck(["--check", "--profile", "intel", "--from", tmp])
      expect(r.status).toBe(1)
      expect(r.stderr).toContain("source file not vendored: decisions/0010-a-new-decision.md")
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})
