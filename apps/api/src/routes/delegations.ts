import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { PostgresDelegationRepository } from "@agentlogin/database";
import { GrantScopeSchema } from "@agent-login/contracts";

const DelegationBody = z.object({
  agent_id: z.string().min(1).max(200),
  scopes: z.array(GrantScopeSchema).min(1).max(5)
}).strict();

export async function delegationRoutes(app: FastifyInstance, options: { database: import("@agentlogin/database").Database }) {
  app.post("/v1/connected-accounts/:accountId/delegations", { preHandler: app.authenticateUser }, async (request, reply) => {
    if (!request.userPrincipal) return reply.code(401).send({ error: { code: "unauthorized", message: "User authentication required." } });
    const parsed = DelegationBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: { code: "invalid_delegation", message: "The delegation request is invalid." } });
    const accountId = (request.params as { accountId: string }).accountId;
    try {
      const result = await new PostgresDelegationRepository(options.database, request.userPrincipal.tenantId).create({
        userId: request.userPrincipal.userId, agentId: parsed.data.agent_id,
        accountId, scopes: parsed.data.scopes
      });
      return reply.code(result.created ? 201 : 200).send({
        status: result.created ? "delegated" : "already_delegated",
        delegation_id: result.delegationId
      });
    } catch {
      return reply.code(403).send({ error: { code: "delegation_denied", message: "The account cannot be delegated to this agent." } });
    }
  });

  app.post("/v1/delegations/:delegationId/revoke", { preHandler: app.authenticateUser }, async (request, reply) => {
    if (!request.userPrincipal) return reply.code(401).send({ error: { code: "unauthorized", message: "User authentication required." } });
    const delegationId = (request.params as { delegationId: string }).delegationId;
    const revoked = await new PostgresDelegationRepository(options.database, request.userPrincipal.tenantId).revoke({
      delegationId, userId: request.userPrincipal.userId
    });
    return reply.send({ status: revoked ? "revoked" : "not_active", delegation_id: delegationId });
  });
}
