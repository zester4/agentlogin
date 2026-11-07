import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Database } from "@agentlogin/database";
import { PostgresAgentCredentialRepository } from "@agentlogin/database";
import { AgentCredentialService, AgentAuthenticationError, type AgentPrincipal } from "@agentlogin/identity";

declare module "fastify" {
  interface FastifyRequest { agentPrincipal: AgentPrincipal | null; }
  interface FastifyInstance { authenticateAgent: (request: FastifyRequest, reply: FastifyReply) => Promise<void>; }
}

export function decodeAgentSigningKey(encoded: string | undefined): Buffer | null {
  if (!encoded || !/^[A-Za-z0-9_-]{43}$/.test(encoded)) return null;
  const key = Buffer.from(encoded, "base64url");
  return key.byteLength === 32 && key.toString("base64url") === encoded ? key : null;
}

export function agentAuthenticationPlugin(
  app: FastifyInstance,
  options: { database: Database; signingKey: Uint8Array | null }
): void {
  app.decorateRequest("agentPrincipal", null);
  app.decorate("authenticateAgent", async (request, reply) => {
    if (!options.signingKey) {
      await reply.code(503).send({ error: { code: "agent_auth_unavailable", message: "Agent authentication is not configured." } });
      return;
    }
    const header = request.headers.authorization;
    if (typeof header !== "string" || !header.startsWith("Bearer ") || header.length > 1100) {
      await reply.code(401).send({ error: { code: "unauthorized", message: "Agent authentication required." } });
      return;
    }
    try {
      const service = new AgentCredentialService(
        (verifiedTenantId) => new PostgresAgentCredentialRepository(options.database, verifiedTenantId),
        options.signingKey
      );
      request.agentPrincipal = await service.authenticate(header.slice(7));
    } catch (error) {
      if (!(error instanceof AgentAuthenticationError)) {
        request.log.error({ err: { name: error instanceof Error ? error.name : "UnknownError" } }, "agent authentication failed");
      }
      await reply.code(401).send({ error: { code: "unauthorized", message: "Agent authentication failed." } });
    }
  });
}
