import type { FastifyInstance } from "fastify";
import { and, desc, eq, or } from "drizzle-orm";
import { auditEvents, grants, withTenantTransaction, type Database } from "@agentlogin/database";

export async function activityRoutes(app: FastifyInstance, options: { database: Database }): Promise<void> {
  app.get("/v1/activity", { preHandler: app.authenticateUser }, async (request, reply) => {
    const principal = request.userPrincipal;
    if (!principal) {
      return reply.code(401).send({ error: { code: "unauthorized", message: "User authentication required." } });
    }

    const events = await withTenantTransaction(options.database, principal.tenantId, async (tx) => {
      return tx.select({
        eventId: auditEvents.id,
        eventType: auditEvents.eventType,
        actorType: auditEvents.actorType,
        decision: auditEvents.decision,
        resourceRef: auditEvents.resourceRef,
        correlationId: auditEvents.correlationId,
        createdAt: auditEvents.createdAt
      }).from(auditEvents)
        .leftJoin(grants, and(
          eq(auditEvents.tenantId, grants.tenantId),
          eq(auditEvents.resourceRef, grants.id)
        ))
        .where(and(
          eq(auditEvents.tenantId, principal.tenantId),
          or(
            eq(auditEvents.actorId, principal.userId),
            eq(grants.userId, principal.userId)
          )
        ))
        .orderBy(desc(auditEvents.createdAt))
        .limit(100);
    });

    return reply.send({
      events: events.map((event) => ({
        event_id: event.eventId,
        event_type: event.eventType,
        actor_type: event.actorType,
        decision: event.decision,
        resource_ref: event.resourceRef,
        correlation_id: event.correlationId,
        created_at: event.createdAt.toISOString()
      }))
    });
  });
}
