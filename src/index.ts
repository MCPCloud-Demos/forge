/**
 * Forge — Code & Issues API.
 *
 * An Apollo GraphQL server fronted by Express, so the deployment can also
 * expose a plain `/healthz` check and the OAuth 2.0 `/oauth/token` endpoint
 * alongside `/graphql`.
 */

import { ApolloServer } from "@apollo/server";
import { expressMiddleware } from "@apollo/server/express4";
import cors from "cors";
import express from "express";

import { buildContext, handleTokenRequest } from "./auth";
import { config } from "./config";
import { prisma } from "./db";
import { resolvers } from "./resolvers";
import { typeDefs } from "./schema";
import { seedIfEmpty } from "./seed";
import { startTrafficGenerator } from "./traffic";

async function main(): Promise<void> {
  if (config.seedOnStartup) {
    await seedIfEmpty();
  }

  const apollo = new ApolloServer({
    typeDefs,
    resolvers,
    // Introspection stays on: MCPCloud ingests the SDL by introspecting the
    // live endpoint, before any OAuth credential is connected.
    introspection: true,
  });
  await apollo.start();

  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.get("/healthz", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.post("/oauth/token", handleTokenRequest);

  app.use(
    "/graphql",
    expressMiddleware(apollo, { context: buildContext }),
  );

  app.get("/", (_req, res) => {
    res.json({
      name: "Forge — Code & Issues API",
      graphql: "/graphql",
      token: "/oauth/token",
      health: "/healthz",
    });
  });

  app.listen(config.port, () => {
    console.log(`Forge listening on :${config.port} (GraphQL at /graphql)`);
  });

  if (config.enableTrafficGenerator) {
    startTrafficGenerator();
  }
}

main().catch(async (err) => {
  console.error("Fatal startup error:", err);
  await prisma.$disconnect();
  process.exit(1);
});
