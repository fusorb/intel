# syntax=docker/dockerfile:1

# --- build: install the workspace and bundle the API -------------------------
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
# The root postinstall runs `prisma generate`; keep it, the API imports the client.
# Build the API bundle, then drop build-only artifacts before they reach the
# runtime stage. Dev dependencies stay: the out-of-band `ingest` / `prisma:migrate`
# jobs run in this image and need tsx + the Prisma CLI. Workspace packages resolve
# to `src/index.ts` (their `exports`), so `packages/*/dist` is never loaded at runtime.
RUN pnpm --filter @fusorb/intel-api build \
  && rm -rf packages/*/dist \
  && find apps packages -name "*.tsbuildinfo" -type f -delete

# --- runtime ----------------------------------------------------------------
# The API bundles the workspace packages into apps/api/dist, so the image only
# needs Node plus the external deps (hono, @hono/node-server, Prisma client, pg).
# The build stage prunes build-only artifacts; the remaining /app is copied whole
# because the in-container `ingest` / `prisma:migrate` jobs need dev tooling.
FROM node:22-slim AS runtime
ENV NODE_ENV=production
# pnpm for migrations; git for in-container ingest.
RUN corepack enable \
  && apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app /app
# The admin scripts (ingest/seed/verify) run `tsx --env-file=.env`, and Node errors
# when that file is missing — provide an empty one so they use the container env,
# plus a writable scratch dir for repo clones.
RUN touch /app/.env && mkdir -p /app/.agent \
  && chown -R node:node /app/.env /app/.agent
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/api/dist/index.js"]
