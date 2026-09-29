import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    envFile: false,
    include: ["packages/provider/test/**/*.test.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
    singleThread: true,
    pool: "threads",
    poolOptions: {
      threads: { singleThread: true },
    },
  },
})
