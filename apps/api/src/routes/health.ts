import type { FastifyInstance } from "fastify";
export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", async () => ({ status: "ok", service: "agentlogin-api" }));
  app.get("/ready", async (_request, reply) => reply.code(503).send({
    status: "not_ready", reason: "persistence_and_security_dependencies_not_configured"
  }));
}
