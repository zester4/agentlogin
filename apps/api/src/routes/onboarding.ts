import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { PostgresOnboardingRepository } from "@agentlogin/database";

const OnboardingBody = z.object({
  tenant_name: z.string().trim().min(1).max(120).optional(),
  developer_name: z.string().trim().min(1).max(120).optional()
}).strict();

export async function onboardingRoutes(app: FastifyInstance, options: { database: import("@agentlogin/database").Database }) {
  app.post("/v1/onboarding", { preHandler: app.authenticateIdentity }, async (request, reply) => {
    const parsed = OnboardingBody.safeParse(request.body ?? {});
    if (!parsed.success || !request.oidcIdentity) {
      return reply.code(400).send({ error: { code: "invalid_onboarding_request", message: "The onboarding request is invalid." } });
    }
    try {
      const result = await new PostgresOnboardingRepository(options.database).onboard({
        tenantId: request.oidcIdentity.tenantId,
        authSubject: request.oidcIdentity.authSubject,
        ...(request.oidcIdentity.displayName ? { userName: request.oidcIdentity.displayName } : {}),
        ...(parsed.data.tenant_name ? { tenantName: parsed.data.tenant_name } : {}),
        ...(parsed.data.developer_name ? { developerName: parsed.data.developer_name } : {})
      });
      return reply.code(200).send({
        status: "onboarded", tenant_id: result.tenantId,
        user_id: result.userId, developer_id: result.developerId,
        membership_role: result.membershipRole
      });
    } catch (error) {
      // Keep credentials and identity claims out of logs. PostgreSQL's code,
      // table, and constraint identify the failing operation without logging
      // request headers, tokens, SQL parameters, or row contents.
      const databaseError = error as {
        code?: unknown;
        constraint?: unknown;
        table?: unknown;
        message?: unknown;
      };
      request.log.error({
        errorCode: typeof databaseError?.code === "string" ? databaseError.code : undefined,
        table: typeof databaseError?.table === "string" ? databaseError.table : undefined,
        constraint: typeof databaseError?.constraint === "string" ? databaseError.constraint : undefined,
        reason: error instanceof Error ? error.message.slice(0, 300) : "Unknown onboarding error"
      }, "Organization setup failed");
      return reply.code(403).send({ error: { code: "onboarding_failed", message: "Organization setup could not be completed." } });
    }
  });
}
