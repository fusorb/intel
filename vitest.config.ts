import { defineConfig } from "vitest/config"
import { resolve } from "node:path"

const root = import.meta.dirname

export default defineConfig({
  resolve: {
    alias: {
      "@fusorb/intel-evidence": resolve(root, "packages/evidence/src/index.ts"),
      "@fusorb/intel-graph": resolve(root, "packages/graph/src/index.ts"),
      "@fusorb/intel-retrieval": resolve(root, "packages/retrieval/src/index.ts"),
      "@fusorb/intel-provider": resolve(root, "packages/provider/src/index.ts"),
      "@fusorb/intel-ingest": resolve(root, "packages/ingest/src/index.ts"),
      "@fusorb/intel-tools": resolve(root, "packages/tools/src/index.ts"),
      "@fusorb/intel-agent": resolve(root, "packages/agent/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    envFile: false,
    include: ["tests/**/*.test.ts", "packages/**/test/**/*.test.ts", "apps/**/test/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    fileParallelism: false, // DB-backed tests share one database — run sequentially
    testTimeout: 30000,
    hookTimeout: 30000,
    singleThread: true,
  },
})
