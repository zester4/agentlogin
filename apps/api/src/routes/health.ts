import type { FastifyInstance } from "fastify";

type HealthOptions = { identityHealthCheck: () => Promise<boolean> };

export async function healthRoutes(app: FastifyInstance, options: HealthOptions) {
  app.get("/health", async () => ({ status: "ok", service: "agentlogin-api" }));
  app.get("/identity/ready", async (_request, reply) => {
    try {
      if (!(await options.identityHealthCheck())) {
        return reply.code(503).send({ status: "not_ready", reason: "identity_database_not_configured_or_unavailable" });
      }
      return { status: "ok", subsystem: "identity" };
    } catch {
      return reply.code(503).send({ status: "not_ready", reason: "identity_database_not_configured_or_unavailable" });
    }
  });
  app.get("/ready", async (_request, reply) => reply.code(503).send({
    status: "not_ready",
    reason: "credential_vault_grants_and_execution_not_configured"
  }));
}
