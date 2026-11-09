import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { PostgresGrantRepository, type Database } from "@agentlogin/database";
import type { ExecutionCoordinator } from "@agentlogin/execution";

const LoginExecutionBody = z.object({
  grant_id: z.string().min(1).max(300),
  task_id: z.string().min(1).max(200).optional()
}).strict();

export type ExecutionCoordinatorFactory = (tenantId: string) => ExecutionCoordinator;

/**
 * Agent-facing login execution boundary.
 *
 * The agent supplies only a grant reference and optional task correlation.
 * Tenant/agent come from verified bearer authentication; user/account/origin/
 * policy version are resolved from the stored grant, never accepted from body.
 */
export async function executionRoutes(
  app: FastifyInstance,
  options: { database: Database; coordinatorForTenant: ExecutionCoordinatorFactory }
) {
  app.post("/v1/executions/login", { preHandler: app.authenticateAgent }, async (request, reply) => {
    const agent = request.agentPrincipal;
    if (!agent) return reply.code(401).send({ error: { code: "unauthorized", message: "Agent authentication required." } });

    const parsed = LoginExecutionBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: "invalid_execution_request", message: "Provide a valid grant_id and optional task_id." } });
    }

    try {
      const grant = await new PostgresGrantRepository(options.database, agent.tenantId).find(parsed.data.grant_id);
      // Return the same response for absent, cross-tenant, or other-agent grants.
      if (!grant || grant.tenantId !== agent.tenantId || grant.agentId !== agent.agentId) {
        return reply.code(404).send({ error: { code: "grant_not_found", message: "The grant was not found." } });
      }

      const coordinator = options.coordinatorForTenant(agent.tenantId);
      const result = await coordinator.login({
        principal: {
          tenantId: agent.tenantId,
          userId: grant.userId,
          agentId: agent.agentId,
          credentialId: agent.credentialId
        },
        grantId: grant.id,
        accountId: grant.accountId,
        origin: grant.origin,
        expectedPolicyVersion: grant.policyVersion,
        ...(parsed.data.task_id ? { taskId: parsed.data.task_id } : {})
      });
      return reply.code(200).send(result);
    } catch (error) {
      request.log.error({ err: { name: error instanceof Error ? error.name : "UnknownError" } }, "login execution request failed");
      return reply.code(503).send({ error: { code: "execution_unavailable", message: "Login execution is temporarily unavailable." } });
    }
  });
}
