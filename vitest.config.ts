import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    envFile: false,
    include: ["tests/**/*.test.ts", "packages/**/test/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    fileParallelism: false, // DB-backed tests share one database — run sequentially
    testTimeout: 30000,
    hookTimeout: 30000,
    singleThread: true,
  },
})
