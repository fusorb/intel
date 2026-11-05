# syntax=docker/dockerfile:1

# --- build: install the workspace and bundle the API -------------------------
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
# The root postinstall runs `prisma generate`; keep it, the API imports the client.
RUN pnpm --filter @fusorb/intel-api build

# --- runtime ----------------------------------------------------------------
# The API bundles the workspace packages into apps/api/dist, so the image only
# needs Node plus the external deps (hono, @hono/node-server, Prisma client, pg).
# Copying the built /app (incl. node_modules + the generated Prisma client) is
# the simplest correct layout; it can be slimmed later with `pnpm deploy`.
FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app /app
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/api/dist/index.js"]
