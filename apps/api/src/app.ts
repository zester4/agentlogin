import Fastify from "fastify";
import { healthRoutes } from "./routes/health.js";
import { identityRoutes } from "./routes/identity.js";
import type { IdentityStore } from "./identity/types.js";
import type { UserTokenVerifier } from "./identity/user-jwt.js";

export type BuildAppOptions = {
  identityStore?: IdentityStore;
  userTokenVerifier?: UserTokenVerifier;
  bootstrapSecret?: string;
};

export function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          "req.headers.x-agentlogin-bootstrap-secret",
          "*.password",
          "*.token",
          "*.secret",
          "*.credential",
          "*.api_key",
          "*.developer_key",
          "*.agent_credential"
        ],
        censor: "[REDACTED]"
      }
    },
    bodyLimit: 1_048_576,
    requestIdHeader: "x-request-id"
  });
  app.register(healthRoutes, {
    identityHealthCheck: options.identityStore ? () => options.identityStore!.healthCheck() : async () => false
  });
  app.register(identityRoutes, {
    store: options.identityStore ?? null,
    userTokenVerifier: options.userTokenVerifier ?? null,
    bootstrapSecret: options.bootstrapSecret ?? null
  });
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
