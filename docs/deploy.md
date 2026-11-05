# Deploying Intel (internal tool)

`intel.fusorb.com` is an **internal, single-user tool** for the system architect. The only
thing exposed is `apps/api` — a read-only HTTP service. Nothing about the database is public.

## What you need

| Piece | Requirement |
|---|---|
| App | `apps/api`, built from the repo `Dockerfile` |
| Database | Postgres with **scram auth**, reachable only by the app (managed, or a private instance) |
| Secrets | `DATABASE_URL`, `INTEL_API_TOKEN` (and provider vars if not self-hosted) |
| Edge | TLS termination + identity (Cloudflare Access) or the bearer token |

## Environment

```bash
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/intel?schema=public
INTEL_API_AUTH=token                 # or cloudflare-access
INTEL_API_TOKEN=<long-random-string> # required when INTEL_API_AUTH=token
INTEL_PROVIDER=ollama                # self-hosted: graph context never leaves the infra
OLLAMA_BASE_URL=http://ollama:11434
OLLAMA_MODEL=llama3.2:latest
PORT=8787
```

Never use the local `trust` auth in production. `INTEL_API_AUTH=none` is development-only.

## Build & run

```bash
docker build -t intel-api .
docker run --rm -p 8787:8787 --env-file .env intel-api
curl -s localhost:8787/health
```

`GET /health` is unauthenticated (platform probes it). Everything else needs auth.

## Database

1. Provision Postgres (managed). Private networking only; no public port.
2. Apply the schema with migrations (not `db push`):
   ```bash
   DATABASE_URL=... pnpm prisma:migrate   # prisma migrate deploy
   ```
3. Populate the graph: `pnpm ingest:all` then `pnpm seed:governance` — run these **out of band**
   (a scheduled job), never per request. The nightly `sync` workflow is the reference.

## Access

**Cloudflare Access (recommended, least code):** put `intel.fusorb.com` behind an Access
application with an allow policy (email = you). The API then reads the injected
`Cf-Access-Authenticated-User-Email` header — set `INTEL_API_AUTH=cloudflare-access`. The
origin must not be reachable except through Access.

**Token (simplest):** `INTEL_API_AUTH=token` + a long `INTEL_API_TOKEN`; callers send
`Authorization: Bearer <token>`. Fine for curl/CLI use.

## Data egress

`INTEL_PROVIDER=ollama` (self-hosted) keeps graph context inside your infrastructure. Any hosted
provider (anthropic/openrouter/openai) sends retrieved context — internal code intelligence —
to a third party. Treat switching providers as an explicit governance decision.

## Host options

Any container host with a managed Postgres works. What each needs:

- **Fly.io** — `fly postgres` (or an external DB); secrets via `fly secrets`; a `fly.toml`.
- **Railway / Render** — connect the repo, add a Postgres addon, set env vars; healthcheck `/health`.
- **VPS behind Cloudflare** — Docker Compose (app + Postgres on a private network) + Cloudflare
  Tunnel/Access; no inbound ports open.

## Hardening recap (already in the app)

Per-identity rate limiting · request-size caps · security headers · uniform JSON errors · no
internal error detail echoed · read-only surface (no SQL, no arbitrary tool) · agent capped at
`INTEL_API_AGENT_MAX_STEPS` with strictly read-only tools.

## Image publishing

`.github/workflows/image.yml` builds the `Dockerfile` on `main` and pushes
`ghcr.io/fusorb/intel/intel-api:latest` (+ the commit SHA). Point your host at that image.
