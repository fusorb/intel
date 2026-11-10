import { serve } from "@hono/node-server"
import { createApp } from "./server.js"
import { loadConfig } from "./config.js"
import { defaultDeps } from "./deps.js"

const config = loadConfig()

if (config.authMode === "token" && !config.authToken) {
  console.error(
    JSON.stringify({
      level: "error",
      msg: "INTEL_API_AUTH=token but INTEL_API_TOKEN is not set — refusing to start",
    }),
  )
  process.exit(1)
}

if (config.authMode === "none" && process.env.NODE_ENV === "production") {
  console.error(
    JSON.stringify({
      level: "error",
      msg: "INTEL_API_AUTH=none is development-only — refusing to start in production",
    }),
  )
  process.exit(1)
}

const app = createApp(defaultDeps, config)

const port = Number(process.env.PORT ?? 8787)
const hostname = process.env.HOST ?? "0.0.0.0"

const server = serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.log(
    JSON.stringify({
      level: "info",
      msg: "intel-api listening",
      hostname,
      port: info.port,
      authMode: config.authMode,
    }),
  )
})

function shutdown(signal: string): void {
  console.log(JSON.stringify({ level: "info", msg: "shutting down", signal }))
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(1), 10_000).unref()
}

process.on("SIGTERM", () => shutdown("SIGTERM"))
process.on("SIGINT", () => shutdown("SIGINT"))
