"use strict"
// Regenerate the Prisma client on install, but skip downloading the binary
// query engine. This project talks to PostgreSQL via @prisma/adapter-pg
// (a driver adapter), so the engine binary is never required at runtime.
// Setting the env var in-process guarantees it is applied for child scripts
// (pnpm lifecycle scripts don't always inherit a PRISMA_SKIP_ENGINE_DOWNLOAD
// that was only present in the caller's shell).
process.env.PRISMA_SKIP_ENGINE_DOWNLOAD = "true"

const { execSync } = require("child_process")
execSync("prisma generate", { stdio: "inherit", env: process.env })
