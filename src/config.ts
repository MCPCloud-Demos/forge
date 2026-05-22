/** Runtime configuration, read once from the environment. */

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value === "true" || value === "1";
}

export const config = {
  // Postgres connection string. Defaults to the docker-compose database for
  // local dev; on Fly.io this is set automatically by the attached cluster.
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgresql://forge:forge@localhost:5432/forge",

  // Demo OAuth access token accepted in `Authorization: Bearer <token>`.
  // Intentionally public — it is a read-mostly demo credential.
  demoToken: process.env.FORGE_DEMO_TOKEN ?? "forge_demo_token_8b3f1d6a2c9e4057",

  // The single demo OAuth client used by the `POST /oauth/token` endpoint.
  clientId: process.env.FORGE_CLIENT_ID ?? "forge-demo-client",
  clientSecret:
    process.env.FORGE_CLIENT_SECRET ?? "forge_demo_secret_5e2a9c7b1f4d8063",

  seedOnStartup: bool(process.env.SEED_ON_STARTUP, true),

  enableTrafficGenerator: bool(process.env.ENABLE_TRAFFIC_GENERATOR, false),
  trafficIntervalSeconds: Number(process.env.TRAFFIC_INTERVAL_SECONDS ?? 180),
  trafficTargetUrl: process.env.TRAFFIC_TARGET_URL ?? "http://127.0.0.1:8080",

  port: Number(process.env.PORT ?? 8080),
};
