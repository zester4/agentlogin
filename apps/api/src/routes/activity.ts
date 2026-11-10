import type { FastifyInstance } from "fastify";
import { and, asc, desc, eq, gt, or, sql } from "drizzle-orm";
import { auditEvents, grants, withTenantTransaction, type Database } from "@agentlogin/database";


type ActivityCursor = { at: Date; id: string };

export function encodeActivityCursor(at: Date, id: string): string {
  return Buffer.from(JSON.stringify({ at: at.toISOString(), id }), "utf8").toString("base64url");
}

export function decodeActivityCursor(value: string): ActivityCursor | null {
  try {
    if (!value || value.length > 512) return null;
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { at?: unknown; id?: unknown };
    if (typeof parsed.at !== "string" || typeof parsed.id !== "string" || !parsed.id || parsed.id.length > 200) return null;
    const at = new Date(parsed.at);
    if (!Number.isFinite(at.getTime()) || at.toISOString() !== parsed.at) return null;
    return { at, id: parsed.id };
  } catch {
    return null;
  }
}

export async function activityRoutes(app: FastifyInstance, options: { database: Database }): Promise<void> {

  app.get("/v1/activity/stream", { preHandler: app.authenticateUser }, async (request, reply) => {
    const principal = request.userPrincipal;
    if (!principal) {
      return reply.code(401).send({ error: { code: "unauthorized", message: "User authentication required." } });
    }

    const headerCursor = request.headers["last-event-id"];
    if (headerCursor !== undefined && (typeof headerCursor !== "string" || !decodeActivityCursor(headerCursor))) {
      return reply.code(400).send({ error: { code: "invalid_event_cursor", message: "The activity stream cursor is invalid." } });
    }
    // A short overlap covers activity committed between the dashboard's initial
    // server render and EventSource connection. Duplicate invalidations are safe.
    let cursor = headerCursor
      ? decodeActivityCursor(headerCursor)!
      : { at: new Date(Date.now() - 60_000), id: "" };

    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    reply.raw.write("retry: 2000\n: connected\n\n");

    let stopped = false;
    let polling = false;
    const poll = async () => {
      if (stopped || polling || reply.raw.destroyed) return;
      polling = true;
      try {
        const events = await withTenantTransaction(options.database, principal.tenantId, async (tx) => {
          // pg Date decoding truncates microseconds; truncate in SQL too so the
          // (timestamp, id) cursor remains stable and cannot replay one row forever.
          const cursorTimestamp = sql<Date>`date_trunc('milliseconds', ${auditEvents.createdAt})`;
          return tx.select({
            id: auditEvents.id,
            createdAt: cursorTimestamp,
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
              ),
              or(
                gt(cursorTimestamp, cursor.at),
                and(eq(cursorTimestamp, cursor.at), gt(auditEvents.id, cursor.id))
              )
            ))
            .orderBy(asc(cursorTimestamp), asc(auditEvents.id))
            .limit(100);
        });
        for (const event of events) {
          if (stopped || reply.raw.destroyed) break;
          const nextCursor = encodeActivityCursor(event.createdAt, event.id);
          reply.raw.write(
            `id: ${nextCursor}\nevent: dashboard.invalidate\ndata: ${JSON.stringify({ event_id: event.id, occurred_at: event.createdAt.toISOString() })}\n\n`
          );
          cursor = { at: event.createdAt, id: event.id };
        }
      } catch {
        if (!stopped && !reply.raw.destroyed) reply.raw.write(": refresh-unavailable\n\n");
      } finally {
        polling = false;
      }
    };

    const pollTimer = setInterval(() => { void poll(); }, 2_000);
    const heartbeatTimer = setInterval(() => {
      if (!stopped && !reply.raw.destroyed) reply.raw.write(": keepalive\n\n");
    }, 15_000);
    const maxLifetimeTimer = setTimeout(() => {
      if (!stopped && !reply.raw.destroyed) reply.raw.end();
    }, 10 * 60_000);

    const cleanup = () => {
      stopped = true;
      clearInterval(pollTimer);
      clearInterval(heartbeatTimer);
      clearTimeout(maxLifetimeTimer);
    };
    reply.raw.on("close", cleanup);
    void poll();
    await new Promise<void>((resolve) => reply.raw.once("close", resolve));
    cleanup();
  });

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
