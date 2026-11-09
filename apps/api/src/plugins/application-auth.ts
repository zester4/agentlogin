import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Database } from "@agentlogin/database";
import { PostgresApplicationCredentialRepository } from "@agentlogin/database";
import { ApplicationCredentialAuthenticationError, ApplicationCredentialService, type ApplicationPrincipal } from "@agentlogin/identity";

declare module "fastify" {
  interface FastifyRequest { applicationPrincipal: ApplicationPrincipal | null; }
  interface FastifyInstance { authenticateApplication: (request: FastifyRequest, reply: FastifyReply) => Promise<void>; }
}

export function decodeApplicationSigningKey(encoded: string | undefined): Buffer | null {
  if (!encoded || !/^[A-Za-z0-9_-]{43}$/.test(encoded)) return null;
  const key = Buffer.from(encoded, "base64url");
  return key.byteLength === 32 && key.toString("base64url") === encoded ? key : null;
}

export function applicationAuthenticationPlugin(app: FastifyInstance, options: { database: Database }): void {
  const signingKey = decodeApplicationSigningKey(process.env.APPLICATION_TOKEN_SIGNING_KEY);
  app.decorateRequest("applicationPrincipal", null);
  app.decorate("authenticateApplication", async (request, reply) => {
    if (!signingKey) {
      await reply.code(503).send({ error: { code: "application_auth_unavailable", message: "Developer application authentication is not configured." } });
      return;
    }
    const header = request.headers.authorization;
    if (typeof header !== "string" || !header.startsWith("Bearer ") || header.length > 1800) {
      await reply.code(401).send({ error: { code: "unauthorized", message: "Developer application authentication required." } });
      return;
    }
    try {
      const service = new ApplicationCredentialService(
        (tenantId) => new PostgresApplicationCredentialRepository(options.database, tenantId),
        signingKey
      );
      request.applicationPrincipal = await service.authenticate(header.slice(7));
    } catch (error) {
      if (!(error instanceof ApplicationCredentialAuthenticationError)) {
        request.log.error({ err: { name: error instanceof Error ? error.name : "UnknownError" } }, "application authentication failed");
      }
      await reply.code(401).send({ error: { code: "unauthorized", message: "Developer application authentication failed." } });
    }
  });
}
