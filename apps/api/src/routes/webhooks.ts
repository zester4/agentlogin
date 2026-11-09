import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { z } from "zod";
import {
  developers, developerMemberships, webhookDeliveryAttempts, webhookDeliveryQueue,
  webhookDeliveries, webhookEndpoints, webhookEvents, withTenantTransaction,
  type Database
} from "@agentlogin/database";
import { AwsKmsProvider, encryptCredential } from "@agentlogin/vault";

const EVENT_TYPES = [
  "account.connected", "account.connection_updated", "account.disconnected",
  "grant.requested", "grant.approval_required", "grant.approved", "grant.denied",
  "grant.revoked", "grant.expired", "execution.started", "execution.completed",
  "execution.failed"
] as const;
const EventType = z.enum(EVENT_TYPES);
const CreateBody = z.object({
  developer_id: z.string().min(8).max(200),
  url: z.string().url().max(2048),
  event_types: z.array(EventType).min(1).max(EVENT_TYPES.length)
}).strict();
const PatchBody = z.object({
  url: z.string().url().max(2048).optional(),
  event_types: z.array(EventType).min(1).max(EVENT_TYPES.length).optional(),
  status: z.enum(["active", "disabled"]).optional()
}).strict().refine((value) => Object.keys(value).length > 0);
const ReplayBody = z.object({}).strict();

function newId(prefix: string): string {
  return prefix + "_" + randomBytes(18).toString("base64url");
}
function safeWebhookUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password &&
      (!url.port || url.port === "443") && !url.hash && !url.hostname.endsWith(".") &&
      url.hostname.length <= 253;
  } catch { return false; }
}
function kmsProvider(): AwsKmsProvider | null {
  const keyId = process.env.AWS_KMS_KEY_ID;
  const region = process.env.AWS_REGION;
  return keyId && region ? new AwsKmsProvider(keyId, region) : null;
}
function unavailable(reply: import("fastify").FastifyReply) {
  return reply.code(503).send({ error: { code: "webhook_vault_unavailable", message: "Webhook signing is not configured." } });
}
async function canManageDeveloper(database: Database, tenantId: string, userId: string, developerId: string): Promise<boolean> {
  return withTenantTransaction(database, tenantId, async (tx) => {
    const rows = await tx.select({ id: developers.id }).from(developers)
      .innerJoin(developerMemberships, and(
        eq(developerMemberships.tenantId, developers.tenantId),
        eq(developerMemberships.developerId, developers.id)
      )).where(and(
        eq(developers.tenantId, tenantId), eq(developers.id, developerId),
        eq(developers.status, "active"), eq(developerMemberships.userId, userId),
        eq(developerMemberships.status, "active"),
        inArray(developerMemberships.role, ["owner", "admin"])
      )).limit(1);
    return rows.length === 1;
  });
}
async function endpointForUser(database: Database, tenantId: string, userId: string, endpointId: string) {
  return withTenantTransaction(database, tenantId, async (tx) => {
    const [row] = await tx.select({
      id: webhookEndpoints.id, developerId: webhookEndpoints.developerId,
      url: webhookEndpoints.url, eventTypes: webhookEndpoints.eventTypes,
      status: webhookEndpoints.status, secretVersion: webhookEndpoints.secretVersion
    }).from(webhookEndpoints).innerJoin(developerMemberships, and(
      eq(developerMemberships.tenantId, webhookEndpoints.tenantId),
      eq(developerMemberships.developerId, webhookEndpoints.developerId)
    )).where(and(
      eq(webhookEndpoints.tenantId, tenantId), eq(webhookEndpoints.id, endpointId),
      eq(developerMemberships.userId, userId), eq(developerMemberships.status, "active"),
      inArray(developerMemberships.role, ["owner", "admin"])
    )).limit(1);
    return row ?? null;
  });
}

export async function webhookRoutes(app: FastifyInstance, options: { database: Database }): Promise<void> {
  const { database } = options;

  app.get("/v1/webhook-endpoints", { preHandler: app.authenticateUser }, async (request, reply) => {
    const principal = request.userPrincipal;
    if (!principal) return reply.code(401).send({ error: { code: "unauthorized", message: "User authentication required." } });
    const endpoints = await withTenantTransaction(database, principal.tenantId, async (tx) =>
      tx.select({
        endpointId: webhookEndpoints.id, developerId: webhookEndpoints.developerId,
        url: webhookEndpoints.url, eventTypes: webhookEndpoints.eventTypes,
        status: webhookEndpoints.status, secretVersion: webhookEndpoints.secretVersion,
        createdAt: webhookEndpoints.createdAt, updatedAt: webhookEndpoints.updatedAt
      }).from(webhookEndpoints).innerJoin(developerMemberships, and(
        eq(developerMemberships.tenantId, webhookEndpoints.tenantId),
        eq(developerMemberships.developerId, webhookEndpoints.developerId)
      )).where(and(
        eq(webhookEndpoints.tenantId, principal.tenantId),
        eq(developerMemberships.userId, principal.userId),
        eq(developerMemberships.status, "active"),
        inArray(developerMemberships.role, ["owner", "admin"])
      )).orderBy(desc(webhookEndpoints.createdAt)).limit(100)
    );
    return reply.send({ endpoints: endpoints.map((item) => ({
      endpoint_id: item.endpointId, developer_id: item.developerId, url: item.url,
      event_types: item.eventTypes, status: item.status, secret_version: item.secretVersion,
      created_at: item.createdAt.toISOString(), updated_at: item.updatedAt.toISOString()
    })) });
  });

  app.post("/v1/webhook-endpoints", { preHandler: app.authenticateUser }, async (request, reply) => {
    const principal = request.userPrincipal;
    const parsed = CreateBody.safeParse(request.body);
    if (!principal || !parsed.success) return reply.code(400).send({ error: { code: "invalid_webhook_endpoint", message: "The webhook endpoint request is invalid." } });
    if (!safeWebhookUrl(parsed.data.url)) return reply.code(400).send({ error: { code: "https_required", message: "Webhook destinations must use HTTPS on port 443 without URL credentials." } });
    if (!await canManageDeveloper(database, principal.tenantId, principal.userId, parsed.data.developer_id)) {
      return reply.code(404).send({ error: { code: "developer_not_found", message: "The developer workspace was not found." } });
    }
    const kms = kmsProvider();
    if (!kms) return unavailable(reply);
    const endpointId = newId("whk");
    const secret = randomBytes(32).toString("base64url");
    const secretBytes = Buffer.from(secret, "utf8");
    const context = {
      tenantId: principal.tenantId, accountId: endpointId, credentialId: endpointId,
      recordVersion: 1, purpose: "webhook_signing_secret" as const
    };
    try {
      const envelope = await encryptCredential(secretBytes, context, kms);
      await withTenantTransaction(database, principal.tenantId, async (tx) => {
        await tx.insert(webhookEndpoints).values({
          id: endpointId, tenantId: principal.tenantId, developerId: parsed.data.developer_id,
          url: parsed.data.url, eventTypes: [...new Set(parsed.data.event_types)], status: "active",
          secretCiphertext: Buffer.from(envelope.ciphertext), secretIv: Buffer.from(envelope.iv),
          secretAuthTag: Buffer.from(envelope.authTag), wrappedDek: Buffer.from(envelope.wrappedDek),
          keyVersion: envelope.keyVersion, secretVersion: 1
        });
      });
      return reply.code(201).send({
        endpoint_id: endpointId, status: "active",
        signing_secret: secret, display_once: true, secret_version: 1
      });
    } catch {
      return reply.code(503).send({ error: { code: "webhook_endpoint_create_failed", message: "The webhook endpoint could not be created." } });
    } finally { secretBytes.fill(0); }
  });

  app.patch("/v1/webhook-endpoints/:endpointId", { preHandler: app.authenticateUser }, async (request, reply) => {
    const principal = request.userPrincipal;
    const parsed = PatchBody.safeParse(request.body);
    if (!principal || !parsed.success) return reply.code(400).send({ error: { code: "invalid_webhook_update", message: "The webhook update is invalid." } });
    if (parsed.data.url && !safeWebhookUrl(parsed.data.url)) return reply.code(400).send({ error: { code: "https_required", message: "Webhook destinations must use HTTPS on port 443." } });
    const endpointId = (request.params as { endpointId: string }).endpointId;
    const owned = await endpointForUser(database, principal.tenantId, principal.userId, endpointId);
    if (!owned) return reply.code(404).send({ error: { code: "webhook_endpoint_not_found", message: "The webhook endpoint was not found." } });
    await withTenantTransaction(database, principal.tenantId, async (tx) => {
      await tx.update(webhookEndpoints).set({
        ...(parsed.data.url ? { url: parsed.data.url } : {}),
        ...(parsed.data.event_types ? { eventTypes: [...new Set(parsed.data.event_types)] } : {}),
        ...(parsed.data.status ? { status: parsed.data.status, disabledAt: parsed.data.status === "disabled" ? new Date() : null } : {}),
        updatedAt: new Date()
      }).where(and(eq(webhookEndpoints.tenantId, principal.tenantId), eq(webhookEndpoints.id, endpointId)));
      if (parsed.data.status === "disabled") {
        await tx.update(webhookDeliveries).set({ status: "cancelled", updatedAt: new Date() })
          .where(and(eq(webhookDeliveries.tenantId, principal.tenantId), eq(webhookDeliveries.endpointId, endpointId), inArray(webhookDeliveries.status, ["pending", "leased"])));
      }
    });
    return reply.send({ endpoint_id: endpointId, status: parsed.data.status ?? owned.status, updated: true });
  });

  app.delete("/v1/webhook-endpoints/:endpointId", { preHandler: app.authenticateUser }, async (request, reply) => {
    const principal = request.userPrincipal;
    if (!principal) return reply.code(401).send({ error: { code: "unauthorized", message: "User authentication required." } });
    const endpointId = (request.params as { endpointId: string }).endpointId;
    const owned = await endpointForUser(database, principal.tenantId, principal.userId, endpointId);
    if (!owned) return reply.code(404).send({ error: { code: "webhook_endpoint_not_found", message: "The webhook endpoint was not found." } });
    await withTenantTransaction(database, principal.tenantId, async (tx) => {
      await tx.update(webhookEndpoints).set({ status: "disabled", disabledAt: new Date(), updatedAt: new Date() })
        .where(and(eq(webhookEndpoints.tenantId, principal.tenantId), eq(webhookEndpoints.id, endpointId)));
      await tx.update(webhookDeliveries).set({ status: "cancelled", updatedAt: new Date() })
        .where(and(eq(webhookDeliveries.tenantId, principal.tenantId), eq(webhookDeliveries.endpointId, endpointId), inArray(webhookDeliveries.status, ["pending", "leased"])));
    });
    return reply.send({ endpoint_id: endpointId, status: "disabled" });
  });

  app.post("/v1/webhook-endpoints/:endpointId/rotate-secret", { preHandler: app.authenticateUser }, async (request, reply) => {
    const principal = request.userPrincipal;
    if (!principal) return reply.code(401).send({ error: { code: "unauthorized", message: "User authentication required." } });
    const endpointId = (request.params as { endpointId: string }).endpointId;
    const owned = await endpointForUser(database, principal.tenantId, principal.userId, endpointId);
    if (!owned || owned.status !== "active") return reply.code(404).send({ error: { code: "webhook_endpoint_not_found", message: "The active webhook endpoint was not found." } });
    const kms = kmsProvider();
    if (!kms) return unavailable(reply);
    const nextVersion = owned.secretVersion + 1;
    const secret = randomBytes(32).toString("base64url");
    const secretBytes = Buffer.from(secret, "utf8");
    const context = {
      tenantId: principal.tenantId, accountId: endpointId, credentialId: endpointId,
      recordVersion: nextVersion, purpose: "webhook_signing_secret" as const
    };
    try {
      const envelope = await encryptCredential(secretBytes, context, kms);
      await withTenantTransaction(database, principal.tenantId, async (tx) => {
        await tx.update(webhookEndpoints).set({
          secretCiphertext: Buffer.from(envelope.ciphertext), secretIv: Buffer.from(envelope.iv),
          secretAuthTag: Buffer.from(envelope.authTag), wrappedDek: Buffer.from(envelope.wrappedDek),
          keyVersion: envelope.keyVersion, secretVersion: nextVersion, updatedAt: new Date()
        }).where(and(eq(webhookEndpoints.tenantId, principal.tenantId), eq(webhookEndpoints.id, endpointId), eq(webhookEndpoints.secretVersion, owned.secretVersion)));
      });
      return reply.send({ endpoint_id: endpointId, signing_secret: secret, display_once: true, secret_version: nextVersion });
    } catch {
      return reply.code(503).send({ error: { code: "webhook_secret_rotation_failed", message: "The signing secret could not be rotated." } });
    } finally { secretBytes.fill(0); }
  });

  app.post("/v1/webhook-endpoints/:endpointId/test", { preHandler: app.authenticateUser }, async (request, reply) => {
    const principal = request.userPrincipal;
    if (!principal) return reply.code(401).send({ error: { code: "unauthorized", message: "User authentication required." } });
    const endpointId = (request.params as { endpointId: string }).endpointId;
    const owned = await endpointForUser(database, principal.tenantId, principal.userId, endpointId);
    if (!owned || owned.status !== "active") return reply.code(404).send({ error: { code: "webhook_endpoint_not_found", message: "The active webhook endpoint was not found." } });
    const eventId = newId("evt"), deliveryId = newId("whd");
    await withTenantTransaction(database, principal.tenantId, async (tx) => {
      await tx.insert(webhookEvents).values({
        id: eventId, tenantId: principal.tenantId, eventType: "webhook.test",
        resourceType: "webhook_endpoint", resourceId: endpointId,
        payload: { test: true, message: "AgentLogin webhook test event." }
      });
      await tx.insert(webhookDeliveries).values({ id: deliveryId, tenantId: principal.tenantId, endpointId, eventId });
      await tx.insert(webhookDeliveryQueue).values({ id: newId("whq"), tenantId: principal.tenantId, deliveryId });
    });
    return reply.code(202).send({ delivery_id: deliveryId, event_id: eventId, status: "queued" });
  });

  app.get("/v1/webhook-deliveries", { preHandler: app.authenticateUser }, async (request, reply) => {
    const principal = request.userPrincipal;
    if (!principal) return reply.code(401).send({ error: { code: "unauthorized", message: "User authentication required." } });
    const query = request.query as { endpoint_id?: string; limit?: string };
    const limit = Math.min(100, Math.max(1, Number(query.limit ?? 50) || 50));
    const conditions = [
      eq(webhookEndpoints.tenantId, principal.tenantId),
      eq(developerMemberships.userId, principal.userId),
      eq(developerMemberships.status, "active"),
      inArray(developerMemberships.role, ["owner", "admin"])
    ];
    if (query.endpoint_id) conditions.push(eq(webhookEndpoints.id, query.endpoint_id));
    const rows = await withTenantTransaction(database, principal.tenantId, async (tx) =>
      tx.select({
        deliveryId: webhookDeliveries.id, endpointId: webhookEndpoints.id,
        endpointUrl: webhookEndpoints.url, eventId: webhookEvents.id, eventType: webhookEvents.eventType,
        status: webhookDeliveries.status, attemptCount: webhookDeliveries.attemptCount,
        maxAttempts: webhookDeliveries.maxAttempts, nextAttemptAt: webhookDeliveries.nextAttemptAt,
        deliveredAt: webhookDeliveries.deliveredAt, createdAt: webhookDeliveries.createdAt,
        attemptNumber: webhookDeliveryAttempts.attemptNumber, outcome: webhookDeliveryAttempts.outcome,
        httpStatus: webhookDeliveryAttempts.httpStatus, latencyMs: webhookDeliveryAttempts.latencyMs,
        errorCode: webhookDeliveryAttempts.errorCode, completedAt: webhookDeliveryAttempts.completedAt
      }).from(webhookDeliveries)
        .innerJoin(webhookEndpoints, and(eq(webhookEndpoints.tenantId, webhookDeliveries.tenantId), eq(webhookEndpoints.id, webhookDeliveries.endpointId)))
        .innerJoin(webhookEvents, and(eq(webhookEvents.tenantId, webhookDeliveries.tenantId), eq(webhookEvents.id, webhookDeliveries.eventId)))
        .innerJoin(developerMemberships, and(eq(developerMemberships.tenantId, webhookEndpoints.tenantId), eq(developerMemberships.developerId, webhookEndpoints.developerId)))
        .leftJoin(webhookDeliveryAttempts, and(eq(webhookDeliveryAttempts.tenantId, webhookDeliveries.tenantId), eq(webhookDeliveryAttempts.deliveryId, webhookDeliveries.id)))
        .where(and(...conditions)).orderBy(desc(webhookDeliveries.createdAt), desc(webhookDeliveryAttempts.attemptNumber)).limit(limit * 8)
    );
    const grouped = new Map<string, {
      delivery_id: string; endpoint_id: string; endpoint_url: string; event_id: string; event_type: string;
      status: string; attempt_count: number; max_attempts: number; next_attempt_at: string;
      delivered_at: string | null; created_at: string; attempts: Array<Record<string, unknown>>;
    }>();
    for (const row of rows) {
      let item = grouped.get(row.deliveryId);
      if (!item) {
        item = {
          delivery_id: row.deliveryId, endpoint_id: row.endpointId, endpoint_url: row.endpointUrl,
          event_id: row.eventId, event_type: row.eventType, status: row.status,
          attempt_count: row.attemptCount, max_attempts: row.maxAttempts,
          next_attempt_at: row.nextAttemptAt.toISOString(), delivered_at: row.deliveredAt?.toISOString() ?? null,
          created_at: row.createdAt.toISOString(), attempts: []
        };
        grouped.set(row.deliveryId, item);
      }
      if (row.attemptNumber !== null) item.attempts.push({
        attempt_number: row.attemptNumber, outcome: row.outcome, http_status: row.httpStatus,
        latency_ms: row.latencyMs, error_code: row.errorCode, completed_at: row.completedAt?.toISOString() ?? null
      });
    }
    return reply.send({ deliveries: [...grouped.values()].slice(0, limit) });
  });

  app.post("/v1/webhook-deliveries/:deliveryId/replay", { preHandler: app.authenticateUser }, async (request, reply) => {
    const principal = request.userPrincipal;
    if (!principal) return reply.code(401).send({ error: { code: "unauthorized", message: "User authentication required." } });
    const deliveryId = (request.params as { deliveryId: string }).deliveryId;
    const replay = await withTenantTransaction(database, principal.tenantId, async (tx) => {
      const [source] = await tx.select({
        endpointId: webhookDeliveries.endpointId, eventId: webhookDeliveries.eventId,
        status: webhookDeliveries.status, endpointStatus: webhookEndpoints.status
      }).from(webhookDeliveries).innerJoin(webhookEndpoints, and(
        eq(webhookEndpoints.tenantId, webhookDeliveries.tenantId),
        eq(webhookEndpoints.id, webhookDeliveries.endpointId)
      )).innerJoin(developerMemberships, and(
        eq(developerMemberships.tenantId, webhookEndpoints.tenantId),
        eq(developerMemberships.developerId, webhookEndpoints.developerId)
      )).where(and(
        eq(webhookDeliveries.tenantId, principal.tenantId),
        eq(webhookDeliveries.id, deliveryId),
        eq(developerMemberships.userId, principal.userId),
        eq(developerMemberships.status, "active"),
        inArray(developerMemberships.role, ["owner", "admin"])
      )).limit(1);
      if (!source || source.endpointStatus !== "active" || !["dead_lettered", "cancelled"].includes(source.status)) return null;
      const newDeliveryId = newId("whd");
      await tx.insert(webhookDeliveries).values({
        id: newDeliveryId, tenantId: principal.tenantId, endpointId: source.endpointId, eventId: source.eventId
      });
      await tx.insert(webhookDeliveryQueue).values({
        id: newId("whq"), tenantId: principal.tenantId, deliveryId: newDeliveryId
      });
      return { deliveryId: newDeliveryId, eventId: source.eventId };
    });
    if (!replay) return reply.code(404).send({ error: { code: "replay_unavailable", message: "The delivery cannot be replayed." } });
    return reply.code(202).send({ delivery_id: replay.deliveryId, event_id: replay.eventId, status: "queued" });
  });
}
