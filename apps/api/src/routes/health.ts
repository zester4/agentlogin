import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";

export async function healthRoutes(
  app: FastifyInstance,
  options: { pool?: Pool } = {},
) {
  app.get("/health", async () => ({ status: "ok", service: "agentlogin-api" }));
  app.get("/ready", async (_request, reply) => {
    if (!options.pool) {
      return reply.code(503).send({
        status: "not_ready",
        reason: "database_connection_not_configured",
      });
    }

    try {
      const result = await options.pool.query<{ tenants: string | null }>(
        "SELECT to_regclass('public.tenants')::text AS tenants",
      );
      if (!result.rows[0]?.tenants) {
        return reply.code(503).send({
          status: "not_ready",
          reason: "database_schema_not_migrated",
        });
      }
      return { status: "ready", database: "connected", schema: "present" };
    } catch {
      return reply.code(503).send({
        status: "not_ready",
        reason: "database_unavailable",
      });
    }
  });
}
