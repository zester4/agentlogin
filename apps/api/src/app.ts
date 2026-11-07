import Fastify from "fastify";
import { healthRoutes } from "./routes/health.js";

export function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          "*.password",
          "*.token",
          "*.secret",
          "*.credential"
        ],
        censor: "[REDACTED]"
      }
    },
    bodyLimit: 1_048_576,
    requestIdHeader: "x-request-id"
  });

  app.register(healthRoutes);
  app.setErrorHandler((error, request, reply) => {
    const safeError = error instanceof Error ? error : new Error("Unknown error");
    request.log.error(
      { err: { name: safeError.name, code: (safeError as Error & { code?: string }).code } },
      "request failed"
    );
    void reply.code(500).send({
      error: { code: "internal_error", message: "The request could not be completed." }
    });
  });

  return app;
}
