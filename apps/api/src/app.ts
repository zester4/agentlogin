import Fastify from "fastify";
import { healthRoutes } from "./routes/health.js";

export function buildApp() {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info", redact: {
      paths: ["req.headers.authorization", "req.headers.cookie", "*.password", "*.token", "*.secret", "*.credential"],
      censor: "[REDACTED]"
    } },
    bodyLimit: 1_048_576,
    requestIdHeader: "x-request-id"
  });
  app.register(healthRoutes);
  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: { name: error.name, code: (error as { code?: string }).code } }, "request failed");
    void reply.code(500).send({ error: { code: "internal_error", message: "The request could not be completed." } });
  });
  return app;
}
