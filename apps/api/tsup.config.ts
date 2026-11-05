import { defineConfig } from "tsup"

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  clean: true,
  sourcemap: true,
  // Bundle the workspace packages: their `exports` point at TypeScript source
  // (src/index.ts), which Node cannot load directly. Real node_modules deps
  // stay external — including Prisma/pg, which are transitive and would
  // otherwise be pulled in (the generated client is multi-MB and needs its
  // runtime engine on disk).
  noExternal: [/^@fusorb\/intel-/],
  external: ["@prisma/client", "@prisma/adapter-pg", "pg"],
})
