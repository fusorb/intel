"use strict"
// Regenerate the Prisma client on install, but skip downloading the binary
// query engine. This project talks to PostgreSQL via @prisma/adapter-pg
// (a driver adapter), so the engine binary is never required at runtime.
// Setting the env var in-process guarantees it is applied for child scripts
// (pnpm lifecycle scripts don't always inherit a PRISMA_SKIP_ENGINE_DOWNLOAD
// that was only present in the caller's shell).
process.env.PRISMA_SKIP_ENGINE_DOWNLOAD = "true"

// `prisma generate` never connects to a database, but Prisma 7 resolves
// prisma.config.ts — which reads env("DATABASE_URL") — before it runs, so a
// missing DATABASE_URL aborted every install that had no .env: CI, the sync
// job, and the Docker build. Supply a placeholder for this child process only.
// Real commands (db push, migrate, ingest, the API) still require the real
// value and still fail loudly without it.
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "postgresql://unused:unused@127.0.0.1:5432/unused"
}

const { execSync } = require("child_process")
execSync("prisma generate", { stdio: "inherit", env: process.env })
