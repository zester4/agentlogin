import type { FastifyInstance } from "fastify";

export async function userRoutes(app: FastifyInstance) {
  app.get("/v1/user/me", { preHandler: app.authenticateUser }, async (request) => ({
    authenticated: true,
    tenant_id: request.userPrincipal!.tenantId,
    user_id: request.userPrincipal!.userId,
    auth_subject: request.userPrincipal!.authSubject
  }));
}
