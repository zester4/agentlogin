import type { FastifyInstance } from "fastify";

export async function agentRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/agent/me", { preHandler: app.authenticateAgent }, async (request) => ({
    authenticated: true,
    principal: {
      tenant_id: request.agentPrincipal!.tenantId,
      developer_id: request.agentPrincipal!.developerId,
      agent_id: request.agentPrincipal!.agentId,
      credential_id: request.agentPrincipal!.credentialId
    }
  }));
}
