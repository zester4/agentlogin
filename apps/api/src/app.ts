import Fastify from "fastify";
import type { Pool } from "pg";
import type { Database } from "@agentlogin/database";
import { healthRoutes } from "./routes/health.js";
import { agentRoutes } from "./routes/agent.js";
import { agentAuthenticationPlugin, decodeAgentSigningKey } from "./plugins/agent-auth.js";

export function buildApp(pool?: Pool, auth?: { database: Database; signingKey: Uint8Array | null }) {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      redact: {
        paths: ["req.headers.authorization", "req.headers.cookie", "*.password", "*.token", "*.secret", "*.credential"],
        censor: "[REDACTED]"
      }
    },
    bodyLimit: 1_048_576,
    requestIdHeader: "x-request-id"
  });

  app.register(healthRoutes, { pool });
  if (auth) {
    agentAuthenticationPlugin(app, auth);
    app.register(agentRoutes);
  }
  if (pool) app.addHook("onClose", async () => { await pool.end(); });
  app.setErrorHandler((error, request, reply) => {
    const safeError = error instanceof Error ? error : new Error("Unknown error");
    request.log.error({ err: { name: safeError.name, code: (safeError as Error & { code?: string }).code } }, "request failed");
    void reply.code(500).send({ error: { code: "internal_error", message: "The request could not be completed." } });
  });
  return app;
}
