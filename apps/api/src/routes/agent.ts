import type { FastifyInstance } from "fastify";
import { PostgresGrantRepository, type Database } from "@agentlogin/database";

export async function agentRoutes(app: FastifyInstance, options: { database: Database }): Promise<void> {
  app.get("/v1/agent/me", { preHandler: app.authenticateAgent }, async (request) => ({
    authenticated: true,
    principal: {
      tenant_id: request.agentPrincipal!.tenantId,
      developer_id: request.agentPrincipal!.developerId,
      agent_id: request.agentPrincipal!.agentId,
      credential_id: request.agentPrincipal!.credentialId
    }
  }));

  app.get("/v1/agent/grants/:grantId", { preHandler: app.authenticateAgent }, async (request, reply) => {
    const principal = request.agentPrincipal;
    if (!principal) return reply.code(401).send({ error: { code: "unauthorized", message: "Agent authentication required." } });
    const grantId = (request.params as { grantId: string }).grantId;
    const grant = await new PostgresGrantRepository(options.database, principal.tenantId).find(grantId);
    if (!grant || grant.tenantId !== principal.tenantId || grant.agentId !== principal.agentId) {
      return reply.code(404).send({ error: { code: "grant_not_found", message: "The access request was not found." } });
    }
    const now = Date.now();
    const status = grant.revokedAt
      ? "revoked"
      : grant.expiresAt.getTime() <= now
        ? "expired"
        : grant.approvalDecision === "approved"
          ? "approved"
          : grant.approvalDecision === "denied"
            ? "denied"
            : "pending_approval";
    return reply.send({
      status,
      grant_id: grant.id,
      origin: grant.origin,
      scopes: grant.scopes,
      expires_at: grant.expiresAt.toISOString(),
      approved_at: grant.approvedAt?.toISOString() ?? null
    });
  });
}
