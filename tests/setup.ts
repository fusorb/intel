import { readFileSync } from "node:fs"
import { resolve } from "node:path"

// Manual .env loader — avoids needing `dotenv` as a dependency.
try {
  const envPath = resolve(process.cwd(), ".env")
  const content = readFileSync(envPath, "utf-8")
  for (const line of content.split("\n")) {
    const trimmed = line.trim()
    if (trimmed.startsWith("#") || !trimmed.includes("=")) continue
    const [key, ...parts] = trimmed.split("=")
    const value = parts.join("=").trim().replace(/^["']|["']$/g, "")
    if (process.env[key] === undefined) {
      process.env[key] = value
    }
  }
} catch {
  // .env file not found — fall through
}

const dbUrl = (globalThis as typeof globalThis & {
  process?: { env?: { DATABASE_URL?: string } }
}).process?.env?.DATABASE_URL
if (!dbUrl) {
  console.warn("Warning: DATABASE_URL is not set. Database-backed tests will be skipped.")
}
