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
    const name = error instanceof Error ? error.name : "UnknownError";
    const code =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : undefined;

    request.log.error({ err: { name, code } }, "request failed");
    void reply.code(500).send({
      error: {
        code: "internal_error",
        message: "The request could not be completed."
      }
    });
  });
  return app;
}
