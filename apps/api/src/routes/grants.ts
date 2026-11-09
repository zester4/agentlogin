import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { PostgresGrantRepository } from "@agentlogin/database";
import { GrantLifecycleError, GrantLifecycleService } from "@agentlogin/policy";

const ApprovalBody = z.object({
  approval_id: z.string().min(1).max(300),
  decision: z.enum(["approved", "denied"])
}).strict();

export async function grantRoutes(app: FastifyInstance, options: { database: import("@agentlogin/database").Database }) {
  app.get("/v1/grants", { preHandler: app.authenticateUser }, async (request, reply) => {
    if (!request.userPrincipal) return reply.code(401).send({ error: { code: "unauthorized", message: "User authentication required." } });
    const grants = await new PostgresGrantRepository(options.database, request.userPrincipal.tenantId)
      .listForUser(request.userPrincipal.userId);
    return reply.send({
      grants: grants.map((grant) => ({
        grant_id: grant.grantId,
        agent_id: grant.agentId,
        agent_name: grant.agentName,
        account_id: grant.accountId,
        account_label: grant.accountLabel,
        origin: grant.origin,
        scopes: grant.scopes,
        task_id: grant.taskId,
        issued_at: grant.issuedAt.toISOString(),
        expires_at: grant.expiresAt.toISOString(),
        revoked_at: grant.revokedAt?.toISOString() ?? null,
        approval_decision: grant.approvalDecision,
        decided_at: grant.decidedAt?.toISOString() ?? null
      }))
    });
  });

  app.get("/v1/grants/pending", { preHandler: app.authenticateUser }, async (request, reply) => {
    if (!request.userPrincipal) return reply.code(401).send({ error: { code: "unauthorized", message: "User authentication required." } });
    const repository = new PostgresGrantRepository(options.database, request.userPrincipal.tenantId);
    const pending = await repository.listPendingForUser(request.userPrincipal.userId);
    return reply.send({ pending });
  });

  app.get("/v1/grants/:grantId", { preHandler: app.authenticateUser }, async (request, reply) => {
    if (!request.userPrincipal) return reply.code(401).send({ error: { code: "unauthorized", message: "User authentication required." } });
    const grantId = (request.params as { grantId: string }).grantId;
    const grant = await new PostgresGrantRepository(options.database, request.userPrincipal.tenantId).find(grantId);
    if (!grant || grant.userId !== request.userPrincipal.userId) {
      return reply.code(404).send({ error: { code: "grant_not_found", message: "The grant was not found." } });
    }
    return reply.send({
      grant_id: grant.id, agent_id: grant.agentId, account_id: grant.accountId,
      origin: grant.origin, scopes: grant.scopes, task_id: grant.taskId,
      policy_version: grant.policyVersion, issued_at: grant.issuedAt.toISOString(),
      expires_at: grant.expiresAt.toISOString(), revoked: grant.revokedAt !== null,
      approval: { approval_id: grant.approvalId, decision: grant.approvalDecision, decided_at: grant.approvedAt?.toISOString() ?? null }
    });
  });

  app.post("/v1/users/:userId/grants", { preHandler: app.authenticateAgent }, async (request, reply) => {
    const agent = request.agentPrincipal;
    if (!agent) return reply.code(401).send({ error: { code: "unauthorized", message: "Agent authentication required." } });
    const userId = (request.params as { userId: string }).userId;
    try {
      const service = new GrantLifecycleService(new PostgresGrantRepository(options.database, agent.tenantId));
      const result = await service.request({
        tenantId: agent.tenantId, userId, agentId: agent.agentId
      }, request.body);
      return reply.code(202).send(result);
    } catch (error) {
      if (error instanceof GrantLifecycleError) {
        const status = error.code === "delegation_required" ? 403 : 400;
        return reply.code(status).send({ error: { code: error.code, message: error.message } });
      }
      return reply.code(503).send({ error: { code: "grant_request_unavailable", message: "The grant request could not be created." } });
    }
  });

  app.post("/v1/grants/:grantId/approval", { preHandler: app.authenticateUser }, async (request, reply) => {
    if (!request.userPrincipal) return reply.code(401).send({ error: { code: "unauthorized", message: "User authentication required." } });
    const parsed = ApprovalBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: { code: "invalid_approval", message: "The approval decision is invalid." } });
    const grantId = (request.params as { grantId: string }).grantId;
    try {
      const service = new GrantLifecycleService(new PostgresGrantRepository(options.database, request.userPrincipal.tenantId));
      const changed = await service.decide({
        principal: { tenantId: request.userPrincipal.tenantId, userId: request.userPrincipal.userId },
        grantId, approvalId: parsed.data.approval_id, decision: parsed.data.decision
      });
      return reply.send({ status: changed ? parsed.data.decision : "already_decided", grant_id: grantId });
    } catch (error) {
      if (error instanceof GrantLifecycleError) {
        const status = error.code === "not_owner" ? 403 : 404;
        return reply.code(status).send({ error: { code: error.code, message: error.message } });
      }
      return reply.code(503).send({ error: { code: "approval_unavailable", message: "The approval could not be recorded." } });
    }
  });

  app.post("/v1/grants/:grantId/revoke", { preHandler: app.authenticateUser }, async (request, reply) => {
    if (!request.userPrincipal) return reply.code(401).send({ error: { code: "unauthorized", message: "User authentication required." } });
    const grantId = (request.params as { grantId: string }).grantId;
    try {
      const service = new GrantLifecycleService(new PostgresGrantRepository(options.database, request.userPrincipal.tenantId));
      const revoked = await service.revoke({
        tenantId: request.userPrincipal.tenantId, userId: request.userPrincipal.userId
      }, grantId);
      return reply.send({ status: revoked ? "revoked" : "already_revoked", grant_id: grantId });
    } catch (error) {
      if (error instanceof GrantLifecycleError) {
        const status = error.code === "not_owner" ? 403 : 404;
        return reply.code(status).send({ error: { code: error.code, message: error.message } });
      }
      return reply.code(503).send({ error: { code: "grant_revocation_unavailable", message: "The grant could not be revoked." } });
    }
  });
}
