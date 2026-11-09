import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";
import { PostgresUserRepository, type AuthenticatedUser, type Database } from "@agentlogin/database";

export type OidcIdentity = { tenantId: string; authSubject: string; displayName?: string };
declare module "fastify" {
  interface FastifyRequest {
    oidcIdentity: OidcIdentity | null;
    userPrincipal: AuthenticatedUser | null;
  }
  interface FastifyInstance {
    authenticateIdentity: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    authenticateUser: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

type OidcVerifier = {
  issuer: string; audience: string; tenantClaim: string;
  jwks: JWTVerifyGetKey;
};
function verifierFromEnvironment(jwksOverride?: JWTVerifyGetKey): OidcVerifier | null {
  const issuer = process.env.OIDC_ISSUER_URL;
  const audience = process.env.OIDC_AUDIENCE;
  const jwksUrl = process.env.OIDC_JWKS_URL;
  const tenantClaim = process.env.OIDC_TENANT_CLAIM ?? "https://agentlogin.app/tenant_id";
  if (!issuer || !audience || !jwksUrl || !tenantClaim) return null;
  try {
    const issuerUrl = new URL(issuer);
    const jwks = new URL(jwksUrl);
    if (issuerUrl.protocol !== "https:" || jwks.protocol !== "https:") return null;
    return { issuer: issuerUrl.toString(), audience, tenantClaim, jwks: jwksOverride ?? createRemoteJWKSet(jwks) };
  } catch { return null; }
}
function identityFromPayload(payload: JWTPayload, tenantClaim: string): OidcIdentity | null {
  const tenantId = payload[tenantClaim];
  const authSubject = payload.sub;
  if (typeof tenantId !== "string" || !tenantId || tenantId.trim() !== tenantId ||
      tenantId.length > 200 || /[\u0000-\u001f\u007f]/.test(tenantId) ||
      typeof authSubject !== "string" || !authSubject || authSubject.length > 255) return null;
  const displayName = typeof payload.name === "string" ? payload.name.slice(0, 120) : undefined;
  return { tenantId, authSubject, ...(displayName ? { displayName } : {}) };
}

export function userAuthenticationPlugin(app: FastifyInstance, options: { database: Database; jwks?: JWTVerifyGetKey }): void {
  const verifier = verifierFromEnvironment(options.jwks);
  app.decorateRequest("oidcIdentity", null);
  app.decorateRequest("userPrincipal", null);

  app.decorate("authenticateIdentity", async (request, reply) => {
    if (!verifier) {
      await reply.code(503).send({ error: { code: "user_auth_unavailable", message: "OIDC user authentication is not configured." } });
      return;
    }
    const authorization = request.headers.authorization;
    if (typeof authorization !== "string" || !authorization.startsWith("Bearer ") || authorization.length > 8200) {
      await reply.code(401).send({ error: { code: "unauthorized", message: "A valid user access token is required." } });
      return;
    }
    try {
      const { payload } = await jwtVerify(authorization.slice(7), verifier.jwks, {
        issuer: verifier.issuer, audience: verifier.audience,
        algorithms: ["RS256", "ES256"], clockTolerance: 5, maxTokenAge: process.env.OIDC_MAX_TOKEN_AGE ?? "24h"
      });
      const identity = identityFromPayload(payload, verifier.tenantClaim);
      if (!identity) {
        await reply.code(401).send({ error: { code: "unauthorized", message: "The identity token is missing required workspace claims." } });
        return;
      }
      request.oidcIdentity = identity;
    } catch {
      await reply.code(401).send({ error: { code: "unauthorized", message: "User authentication failed." } });
    }
  });

  app.decorate("authenticateUser", async (request, reply) => {
    await app.authenticateIdentity(request, reply);
    if (reply.sent || !request.oidcIdentity) return;
    try {
      const repository = new PostgresUserRepository(options.database, request.oidcIdentity.tenantId);
      const user = await repository.findActiveBySubject(request.oidcIdentity.authSubject);
      if (!user) {
        await reply.code(403).send({ error: { code: "user_not_onboarded", message: "Complete workspace onboarding before using this endpoint." } });
        return;
      }
      request.userPrincipal = user;
    } catch {
      await reply.code(403).send({ error: { code: "user_not_authorized", message: "The user is not authorized for this workspace." } });
    }
  });
}
