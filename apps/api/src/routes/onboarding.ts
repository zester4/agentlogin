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
    } catch {
      return reply.code(403).send({ error: { code: "onboarding_failed", message: "Workspace onboarding could not be completed." } });
    }
  });
}
