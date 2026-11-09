import Fastify from "fastify";
import type { Pool } from "pg";
import type { Database } from "@agentlogin/database";
import { healthRoutes } from "./routes/health.js";
import { agentRoutes } from "./routes/agent.js";
import { agentAuthenticationPlugin } from "./plugins/agent-auth.js";
import { userAuthenticationPlugin } from "./plugins/user-auth.js";
import { onboardingRoutes } from "./routes/onboarding.js";
import { userRoutes } from "./routes/user.js";
import { developerRoutes } from "./routes/developers.js";
import { connectedAccountRoutes } from "./routes/connected-accounts.js";
import { grantRoutes } from "./routes/grants.js";
import { delegationRoutes } from "./routes/delegations.js";
import { activityRoutes } from "./routes/activity.js";
import { kmsDiagnosticRoutes } from "./routes/kms-diagnostic.js";
import { vaultLifecycleDiagnosticRoutes } from "./routes/vault-lifecycle-diagnostic.js";
import { applicationRoutes } from "./routes/applications.js";
import { applicationAuthenticationPlugin } from "./plugins/application-auth.js";
import { executionRoutes, type ExecutionCoordinatorFactory } from "./routes/executions.js";

export function buildApp(pool?: Pool, auth?: { database: Database; signingKey: Uint8Array | null; coordinatorForTenant?: ExecutionCoordinatorFactory }) {
  const app = Fastify({
    trustProxy: true,
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      redact: {
        paths: ["req.headers.authorization", "req.headers.cookie", "req.body.password", "req.body.username", "*.password", "*.token", "*.secret", "*.credential"],
        censor: "[REDACTED]"
      }
    },
    bodyLimit: 1_048_576,
    requestIdHeader: "x-request-id"
  });

  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_request, body, done) => {
    try { done(null, Object.fromEntries(new URLSearchParams(body as string))); }
    catch (error) { done(error as Error); }
  });

  app.register(healthRoutes, { pool });
  // Internal diagnostics are inert (404) unless a temporary high-entropy token
  // is configured. They use synthetic data only and never return credential material.
  app.register(kmsDiagnosticRoutes);
  app.register(vaultLifecycleDiagnosticRoutes, auth ? { database: auth.database } : {});
  if (auth) {
    agentAuthenticationPlugin(app, auth);
    userAuthenticationPlugin(app, { database: auth.database });
    applicationAuthenticationPlugin(app, { database: auth.database });
    app.register(agentRoutes, { database: auth.database });
    app.register(onboardingRoutes, { database: auth.database });
    app.register(userRoutes);
    app.register(developerRoutes, { database: auth.database });
    app.register(applicationRoutes, { database: auth.database });
    app.register(connectedAccountRoutes, { database: auth.database });
    app.register(grantRoutes, { database: auth.database });
    app.register(delegationRoutes, { database: auth.database });
    app.register(activityRoutes, { database: auth.database });
    if (auth.coordinatorForTenant) {
      app.register(executionRoutes, { database: auth.database, coordinatorForTenant: auth.coordinatorForTenant });
    }
  }
  if (pool) app.addHook("onClose", async () => { await pool.end(); });
  app.setErrorHandler((error, request, reply) => {
    const safeError = error instanceof Error ? error : new Error("Unknown error");
    request.log.error({ err: { name: safeError.name, code: (safeError as Error & { code?: string }).code } }, "request failed");
    void reply.code(500).send({ error: { code: "internal_error", message: "The request could not be completed." } });
  });
  return app;
}
