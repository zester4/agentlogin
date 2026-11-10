import { randomBytes } from "node:crypto";
import { isIP } from "node:net";
import type { FastifyInstance } from "fastify";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  withTenantTransaction,
  webhookEndpoints,
  PostgresDeveloperRepository,
} from "@agentlogin/database";
import { AwsKmsProvider, encryptCredential } from "@agentlogin/vault";

const EventTypes = [
  "account.connected", "account.connection_updated", "account.disconnected",
  "grant.requested", "grant.approval_required", "grant.approved", "grant.denied",
  "grant.revoked", "grant.expired", "execution.started", "execution.completed",
  "execution.failed",
] as const;

const EventTypesSchema = z.array(z.enum(EventTypes)).min(1).max(EventTypes.length)
  .refine((items) => new Set(items).size === items.length, "Event types must be unique.");

const CreateEndpointBody = z.object({
  url: z.string().url().max(2048),
  event_types: EventTypesSchema,
}).strict();

const UpdateEndpointBody = z.object({
  url: z.string().url().max(2048).optional(),
  event_types: EventTypesSchema.optional(),
  status: z.enum(["active", "disabled"]).optional(),
}).strict().refine((body) => Object.keys(body).length > 0, "At least one field is required.");

export function normalizeWebhookUrl(value: string): string {
  const parsed = new URL(value);
  const hostname = parsed.hostname.toLowerCase().replace(/^\\[|\\]$/g, "");
  const localHostname = hostname === "localhost" || hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") || hostname.endsWith(".internal") || hostname === "metadata.google.internal";
  if (parsed.protocol !== "https:" || parsed.username || parsed.password ||
      parsed.hash || parsed.hostname.endsWith(".") || isIP(hostname) !== 0 || localHostname ||
      (parsed.port && parsed.port !== "443")) {
    throw new TypeError("Webhook destinations must be credential-free HTTPS URLs on port 443.");
  }
  return parsed.toString();
}

function webhookFeatureEnabled(): boolean {
  return process.env.WEBHOOK_ENDPOINTS_ENABLED === "true";
}

function kmsProvider(): AwsKmsProvider | null {
  const keyId = process.env.AWS_KMS_KEY_ID;
  const region = process.env.AWS_REGION;
  return keyId && region ? new AwsKmsProvider(keyId, region) : null;
}

async function managedDeveloper(
  database: import("@agentlogin/database").Database,
  tenantId: string,
  userId: string,
  developerId: string,
): Promise<boolean> {
  const developers = await new PostgresDeveloperRepository(database, tenantId).listManagedDevelopers(userId);
  return developers.some((developer) =>
    developer.developerId === developerId &&
    (developer.role === "owner" || developer.role === "admin")
  );
}

function endpointId(): string {
  return "whend_" + randomBytes(18).toString("base64url");
}

function oneTimeSecret(): string {
  return randomBytes(32).toString("base64url");
}

export async function webhookEndpointRoutes(
  app: FastifyInstance,
  options: { database: import("@agentlogin/database").Database },
) {
  app.get("/v1/developers/:developerId/webhook-endpoints", {
    preHandler: app.authenticateUser,
  }, async (request, reply) => {
    const principal = request.userPrincipal;
    if (!principal) return reply.code(401).send({ error: { code: "unauthorized", message: "User authentication required." } });
    const developerId = (request.params as { developerId: string }).developerId;
    if (!(await managedDeveloper(options.database, principal.tenantId, principal.userId, developerId))) {
      return reply.code(404).send({ error: { code: "developer_not_found", message: "The developer workspace was not found." } });
    }
    const endpoints = await withTenantTransaction(options.database, principal.tenantId, async (tx) =>
      tx.select({
        endpoint_id: webhookEndpoints.id,
        url: webhookEndpoints.url,
        event_types: webhookEndpoints.eventTypes,
        status: webhookEndpoints.status,
        secret_version: webhookEndpoints.secretVersion,
        created_at: webhookEndpoints.createdAt,
        updated_at: webhookEndpoints.updatedAt,
      }).from(webhookEndpoints).where(and(
        eq(webhookEndpoints.tenantId, principal.tenantId),
        eq(webhookEndpoints.developerId, developerId),
      )).orderBy(desc(webhookEndpoints.createdAt)).limit(100)
    );
    return reply.header("Cache-Control", "no-store").send({ endpoints });
  });

  app.post("/v1/developers/:developerId/webhook-endpoints", {
    preHandler: app.authenticateUser,
  }, async (request, reply) => {
    if (!webhookFeatureEnabled()) {
      return reply.code(423).send({ error: { code: "webhook_endpoint_management_locked", message: "Webhook endpoint management is not enabled yet." } });
    }
    const principal = request.userPrincipal;
    const parsed = CreateEndpointBody.safeParse(request.body);
    if (!principal) return reply.code(401).send({ error: { code: "unauthorized", message: "User authentication required." } });
    if (!parsed.success) return reply.code(400).send({ error: { code: "invalid_webhook_endpoint", message: "The webhook endpoint request is invalid." } });
    const developerId = (request.params as { developerId: string }).developerId;
    if (!(await managedDeveloper(options.database, principal.tenantId, principal.userId, developerId))) {
      return reply.code(404).send({ error: { code: "developer_not_found", message: "The developer workspace was not found." } });
    }
    let url: string;
    try { url = normalizeWebhookUrl(parsed.data.url); }
    catch { return reply.code(400).send({ error: { code: "invalid_webhook_url", message: "Webhook destinations must be credential-free HTTPS URLs on port 443." } }); }
    const kms = kmsProvider();
    if (!kms) return reply.code(503).send({ error: { code: "webhook_signing_unavailable", message: "Webhook signing is not configured." } });

    const id = endpointId();
    const secret = oneTimeSecret();
    const plaintext = Buffer.from(secret, "utf8");
    const context = {
      tenantId: principal.tenantId,
      accountId: "webhook:" + developerId,
      credentialId: id,
      recordVersion: 1,
      purpose: "webhook_signing_secret" as const,
    };
    try {
      const envelope = await encryptCredential(plaintext, context, kms);
      await withTenantTransaction(options.database, principal.tenantId, async (tx) => {
        await tx.insert(webhookEndpoints).values({
          id, tenantId: principal.tenantId, developerId, url,
          eventTypes: parsed.data.event_types, status: "active",
          secretCiphertext: Buffer.from(envelope.ciphertext),
          secretIv: Buffer.from(envelope.iv),
          secretAuthTag: Buffer.from(envelope.authTag),
          wrappedDek: Buffer.from(envelope.wrappedDek),
          keyVersion: envelope.keyVersion,
          secretVersion: 1,
        });
      });
      return reply.code(201).header("Cache-Control", "no-store").send({
        endpoint_id: id, url, event_types: parsed.data.event_types,
        status: "active", signing_secret: secret, secret_version: 1,
        warning: "Store this signing secret now. It will not be shown again.",
      });
    } catch {
      return reply.code(503).send({ error: { code: "webhook_endpoint_creation_failed", message: "The webhook endpoint could not be created." } });
    } finally {
      plaintext.fill(0);
    }
  });

  app.patch("/v1/developers/:developerId/webhook-endpoints/:endpointId", {
    preHandler: app.authenticateUser,
  }, async (request, reply) => {
    if (!webhookFeatureEnabled()) {
      return reply.code(423).send({ error: { code: "webhook_endpoint_management_locked", message: "Webhook endpoint management is not enabled yet." } });
    }
    const principal = request.userPrincipal;
    const parsed = UpdateEndpointBody.safeParse(request.body);
    if (!principal) return reply.code(401).send({ error: { code: "unauthorized", message: "User authentication required." } });
    if (!parsed.success) return reply.code(400).send({ error: { code: "invalid_webhook_endpoint_update", message: "The webhook endpoint update is invalid." } });
    const { developerId, endpointId: id } = request.params as { developerId: string; endpointId: string };
    if (!(await managedDeveloper(options.database, principal.tenantId, principal.userId, developerId))) {
      return reply.code(404).send({ error: { code: "webhook_endpoint_not_found", message: "The webhook endpoint was not found." } });
    }
    let url: string | undefined;
    if (parsed.data.url !== undefined) {
      try { url = normalizeWebhookUrl(parsed.data.url); }
      catch { return reply.code(400).send({ error: { code: "invalid_webhook_url", message: "Webhook destinations must be credential-free HTTPS URLs on port 443." } }); }
    }
    const updated = await withTenantTransaction(options.database, principal.tenantId, async (tx) => {
      const [row] = await tx.update(webhookEndpoints).set({
        ...(url === undefined ? {} : { url }),
        ...(parsed.data.event_types === undefined ? {} : { eventTypes: parsed.data.event_types }),
        ...(parsed.data.status === undefined ? {} : {
          status: parsed.data.status,
          disabledAt: parsed.data.status === "disabled" ? new Date() : null,
        }),
        updatedAt: new Date(),
      }).where(and(
        eq(webhookEndpoints.tenantId, principal.tenantId),
        eq(webhookEndpoints.developerId, developerId),
        eq(webhookEndpoints.id, id),
      )).returning({ id: webhookEndpoints.id, status: webhookEndpoints.status });
      return row ?? null;
    });
    if (!updated) return reply.code(404).send({ error: { code: "webhook_endpoint_not_found", message: "The webhook endpoint was not found." } });
    return reply.send({ endpoint_id: id, status: updated.status });
  });

  app.delete("/v1/developers/:developerId/webhook-endpoints/:endpointId", {
    preHandler: app.authenticateUser,
  }, async (request, reply) => {
    if (!webhookFeatureEnabled()) {
      return reply.code(423).send({ error: { code: "webhook_endpoint_management_locked", message: "Webhook endpoint management is not enabled yet." } });
    }
    const principal = request.userPrincipal;
    if (!principal) return reply.code(401).send({ error: { code: "unauthorized", message: "User authentication required." } });
    const { developerId, endpointId: id } = request.params as { developerId: string; endpointId: string };
    if (!(await managedDeveloper(options.database, principal.tenantId, principal.userId, developerId))) {
      return reply.code(404).send({ error: { code: "webhook_endpoint_not_found", message: "The webhook endpoint was not found." } });
    }
    const disabled = await withTenantTransaction(options.database, principal.tenantId, async (tx) => {
      const [row] = await tx.update(webhookEndpoints).set({
        status: "disabled", disabledAt: new Date(), updatedAt: new Date(),
      }).where(and(
        eq(webhookEndpoints.tenantId, principal.tenantId),
        eq(webhookEndpoints.developerId, developerId),
        eq(webhookEndpoints.id, id),
      )).returning({ id: webhookEndpoints.id });
      return row ?? null;
    });
    if (!disabled) return reply.code(404).send({ error: { code: "webhook_endpoint_not_found", message: "The webhook endpoint was not found." } });
    return reply.code(204).send();
  });
}
