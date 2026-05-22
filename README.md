# Forge — Code & Issues API

A GitHub-style developer-platform API built with **Apollo Server + Prisma**,
served on **Bun**. Forge is look-alike server #2 in the MCPCloud showcase — a
real, deployed, callable GraphQL API used to demonstrate ingesting a schema by
**introspection**, enriching terse SDL descriptions, generating a typed MCP
server, and running it through the platform end to end.

It is intentionally **terse**: most operations carry no SDL description, and the
few that do are one word (`Merge.`, `Search.`, `Close.`). That "before" state is
the setup for MCPCloud's enrichment payoff.

## Quick start

```bash
docker compose up -d        # local Postgres
bun install
bun run dev                 # pushes the Prisma schema, then starts with reload
```

The server starts on `http://127.0.0.1:8080`. It seeds the demo tenant
automatically on first run.

- GraphQL endpoint (the ingestion URL): `http://127.0.0.1:8080/graphql`
- OAuth token endpoint: `http://127.0.0.1:8080/oauth/token`
- Health check: `http://127.0.0.1:8080/healthz`

`bun run start` is a production-style start (no reload, no schema push).

## Authentication

Forge uses **OAuth 2.0** bearer tokens. Exchange the demo client credentials for
an access token via the client-credentials grant:

```bash
curl -X POST http://127.0.0.1:8080/oauth/token \
  -d grant_type=client_credentials \
  -d client_id=forge-demo-client \
  -d client_secret=forge_demo_secret_5e2a9c7b1f4d8063
```

That returns the demo access token. Pass it on every GraphQL request:

```bash
curl http://127.0.0.1:8080/graphql \
  -H "Authorization: Bearer forge_demo_token_8b3f1d6a2c9e4057" \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ repositories { name owner stars } }"}'
```

The token maps to an isolated demo tenant; all data is scoped to it. Schema
**introspection is open** (no token required) so MCPCloud can ingest the SDL
before a credential is connected. Override the credentials with the
`FORGE_DEMO_TOKEN`, `FORGE_CLIENT_ID`, and `FORGE_CLIENT_SECRET` env vars.

## Data model

`Repository`, `Issue`, `PullRequest`, `Review`, `Comment`, `Label`, `Branch`,
`Commit`, `User`. A `PullRequest` moves through `OPEN` / `DRAFT` → `MERGED` /
`CLOSED`. Merging is blocked when the PR is a draft or carries an unresolved
`CHANGES_REQUESTED` review.

## Operations (19)

**9 queries:** `repositories`, `repository`, `issues`, `issue`, `pullRequests`,
`pullRequest`, `labels`, `search`, `user`.

**10 mutations:** `createIssue`, `updateIssue`, `closeIssue`, `addComment`,
`addLabels`, `createPullRequest`, `mergePullRequest`, `requestReview`,
`submitReview`, `createBranch`.

## Seed data

`bun run seed` wipes and re-seeds the demo tenant (this is what the nightly
reset job runs). The seed is deterministic: 12 users, 4 repositories, 30 issues
across open/closed, and 15 pull requests — some with no reviewer, some stale,
one with failing checks, one a draft, and one carrying a `CHANGES_REQUESTED`
review — so the companion "PR Review Readiness Sweep" skill has real work.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `postgresql://forge:forge@localhost:5432/forge` | Postgres URL; Fly.io sets this automatically |
| `FORGE_DEMO_TOKEN` | `forge_demo_token_8b3f1d6a2c9e4057` | Accepted bearer token |
| `FORGE_CLIENT_ID` | `forge-demo-client` | OAuth client id |
| `FORGE_CLIENT_SECRET` | `forge_demo_secret_5e2a9c7b1f4d8063` | OAuth client secret |
| `SEED_ON_STARTUP` | `true` | Seed the demo tenant when the database is empty |
| `ENABLE_TRAFFIC_GENERATOR` | `false` | Run the in-app traffic generator (on for the Fly deploy) |
| `TRAFFIC_INTERVAL_SECONDS` | `180` | Seconds between traffic-generator cycles |
| `TRAFFIC_TARGET_URL` | `http://127.0.0.1:8080` | Base URL the generator calls |

## Tests

```bash
docker compose up -d        # api tests need Postgres; schema tests do not
bun test
```

## Deployment (Fly.io)

Live at **https://api.forge.mcpcloud-demo.com/graphql** — app
`forge-mcpcloud-demo` in the `mcpcloud-demos` org, backed by Fly Postgres,
behind a Let's Encrypt cert (DNS managed in Cloudflare, "DNS only" / unproxied).

To reproduce the provisioning from scratch:

```bash
fly apps create forge-mcpcloud-demo --org mcpcloud-demos
fly postgres create --name forge-mcpcloud-demo-db --org mcpcloud-demos --region iad
fly postgres attach forge-mcpcloud-demo-db --app forge-mcpcloud-demo  # sets DATABASE_URL
fly secrets set \
  FORGE_DEMO_TOKEN=forge_demo_token_8b3f1d6a2c9e4057 \
  FORGE_CLIENT_ID=forge-demo-client \
  FORGE_CLIENT_SECRET=forge_demo_secret_5e2a9c7b1f4d8063 \
  --app forge-mcpcloud-demo
fly deploy
fly certs add api.forge.mcpcloud-demo.com --app forge-mcpcloud-demo  # then add A/AAAA in DNS
```

The container start command runs `prisma db push` against the attached Postgres
before launching the server, so the schema is created on first deploy.

### Nightly reset

A scheduled Fly Machine (`forge-nightly-reset`, process group `reset`) runs
`bun run src/seed.ts` once every 24h to wipe and re-seed the demo tenant. It is
separate from the `app` process group, so `fly deploy` leaves it untouched.

```bash
fly machine run \
  --app forge-mcpcloud-demo --schedule daily --restart no \
  --name forge-nightly-reset --region iad --vm-memory 512 \
  --metadata fly_process_group=reset \
  registry.fly.io/forge-mcpcloud-demo:<current-deployment-tag> \
  -- bun run src/seed.ts
```

The reset Machine is **pinned to the image tag it was created with** — a later
`fly deploy` does not update it. After a deploy that changes the data model or
the seed script, recreate it: `fly machine destroy forge-nightly-reset --force`,
then re-run the command above with the new deployment tag (`fly image show`).

### Traffic generator

When `ENABLE_TRAFFIC_GENERATOR=true` (set in `fly.toml`), the app starts a
background loop that, every `TRAFFIC_INTERVAL_SECONDS`, runs a rotating handful
of GraphQL operations — and every fifth cycle opens and closes an issue. This
keeps the deployment visibly live at no extra cost. Anything it writes is
cleared by the nightly reset.
