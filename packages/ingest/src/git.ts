import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { resolve } from "node:path"

/** Working directory for cloned Fusorb repos (gitignored scratch). */
export const AGENT_REPOS = resolve(process.cwd(), ".agent", "repos")

/** Derive a repository name from its clone URL. */
export function repositoryNameFromUrl(url: string): string {
  const cleaned = url.replace(/#.*$/, "").replace(/\.git$/, "")
  const segments = cleaned.split("/")
  const last = segments[segments.length - 1]
  if (!last) throw new Error(`Could not derive repository name from URL: ${url}`)
  return last
}

/** Clone a fresh repo or, if present locally, fetch + hard-reset to the requested ref. */
export function cloneOrFetch(repoUrl: string, dest: string, branch: string | null): string {
  if (existsSync(dest)) {
    execFileSync("git", ["-C", dest, "fetch", "--quiet", "--prune", "origin"])
    const ref = branch ? `origin/${branch}` : "origin/HEAD"
    execFileSync("git", ["-C", dest, "reset", "--hard", ref])
    execFileSync("git", ["-C", dest, "clean", "-fd"])
  } else {
    const args: string[] = ["clone", "--quiet", "--no-tags", "--depth=1"]
    if (branch) args.push("--branch", branch)
    args.push(repoUrl, dest)
    execFileSync("git", args)
  }
  return currentCommit(dest)
}

/** Return the commit SHA the working tree is currently sitting on. */
export function currentCommit(dest: string): string {
  return execFileSync("git", ["-C", dest, "rev-parse", "HEAD"], { encoding: "utf-8" }).trim()
}

/** Best-effort default branch name for the checked-out working tree. */
export function defaultBranch(dest: string): string | null {
  try {
    const ref = execFileSync("git", ["-C", dest, "rev-parse", "--abbrev-ref", "HEAD"], {
      encoding: "utf-8",
    }).trim()
    return ref || null
  } catch {
    return null
  }
}
