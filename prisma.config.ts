import { defineConfig, env } from "prisma/config";

// Prisma 6.18+ / 7: the connection URL lives here, not in schema.prisma's
// datasource block.
export default defineConfig({
  schema: "schemas/graph.prisma",
  migrations: {
    path: "schemas/migrations",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
