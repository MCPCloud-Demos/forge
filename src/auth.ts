/**
 * OAuth 2.0 bearer auth for Forge.
 *
 * `POST /oauth/token` is a minimal client-credentials grant: the single demo
 * OAuth client exchanges its id/secret for an access token. Every GraphQL data
 * resolver then requires that token in the `Authorization: Bearer` header.
 * Schema introspection is intentionally left open so MCPCloud can ingest the
 * SDL before a credential is connected.
 */

import type { Request, Response } from "express";
import { GraphQLError } from "graphql";

import { config } from "./config";

export interface ForgeContext {
  tenant: string | null;
}

function extractBearer(req: Request): string | null {
  const header = req.headers["authorization"];
  if (!header || Array.isArray(header)) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

/** Apollo context factory — resolves the demo tenant when the token is valid. */
export async function buildContext({
  req,
}: {
  req: Request;
}): Promise<ForgeContext> {
  const token = extractBearer(req);
  const tenant = token && token === config.demoToken ? "demo" : null;
  return { tenant };
}

/** Guard used at the top of every data resolver. */
export function requireAuth(ctx: ForgeContext): string {
  if (!ctx.tenant) {
    throw new GraphQLError("Missing or invalid OAuth bearer token", {
      extensions: { code: "UNAUTHENTICATED", http: { status: 401 } },
    });
  }
  return ctx.tenant;
}

/** Express handler for the OAuth 2.0 client-credentials token endpoint. */
export function handleTokenRequest(req: Request, res: Response): void {
  const body = (req.body ?? {}) as Record<string, string>;

  if (body.grant_type !== "client_credentials") {
    res.status(400).json({
      error: "unsupported_grant_type",
      error_description: "Only client_credentials is supported.",
    });
    return;
  }

  if (
    body.client_id !== config.clientId ||
    body.client_secret !== config.clientSecret
  ) {
    res.status(401).json({
      error: "invalid_client",
      error_description: "Unknown client id or secret.",
    });
    return;
  }

  res.json({
    access_token: config.demoToken,
    token_type: "Bearer",
    expires_in: 3600,
    scope: "repo issues pull_requests",
  });
}
