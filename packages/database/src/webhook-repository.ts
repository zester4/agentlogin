import { and, arrayOverlaps, eq } from "drizzle-orm";
import type { TenantTransaction } from "./types.js";
import { webhookDeliveries, webhookEndpoints, webhookEvents } from "./schema.js";

export interface EnqueueWebhookEventInput {
  tenantId: string;
  eventId?: string;
  eventType: string;
  resourceType: string;
  resourceId: string;
  occurredAt?: Date;
  payload?: Record<string, unknown>;
}

const forbiddenPayloadKey = /(?:authorization|cookie|password|passwd|secret|token|credential|recovery|private.?key|ciphertext|wrapped.?dek|browser.?state|provider.?response)/i;

function assertSafePayload(value: unknown, path = "payload"): void {
  if (value === null || typeof value === "boolean" || typeof value === "number") return;
  if (typeof value === "string") {
    if (value.length > 2048) throw new Error(`Webhook ${path} contains an oversized string.`);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 100) throw new Error(`Webhook ${path} contains too many items.`);
    value.forEach((item, index) => assertSafePayload(item, `${path}[${index}]`));
    return;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > 50) throw new Error(`Webhook ${path} contains too many fields.`);
    for (const [key, item] of entries) {
      if (forbiddenPayloadKey.test(key)) {
        throw new Error(`Webhook payload contains a prohibited field: ${key}.`);
      }
      assertSafePayload(item, `${path}.${key}`);
    }
    return;
  }
  throw new Error(`Webhook ${path} contains an unsupported value.`);
}

/**
 * Insert the immutable outbox event and its endpoint deliveries using the
 * caller's existing tenant transaction. Call only inside the same transaction
 * as the domain state change; delivery is asynchronous and never inline.
 */
export async function enqueueWebhookEvent(
  tx: TenantTransaction,
  input: EnqueueWebhookEventInput,
): Promise<{ eventId: string; deliveryIds: string[] }> {
  if (!input.tenantId || !input.eventType || !input.resourceType || !input.resourceId) {
    throw new Error("Webhook event identity is incomplete.");
  }
  const payload = input.payload ?? {};
  assertSafePayload(payload);

  const eventId = input.eventId ?? crypto.randomUUID();
  await tx.insert(webhookEvents).values({
    id: eventId,
    tenantId: input.tenantId,
    eventType: input.eventType,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    occurredAt: input.occurredAt ?? new Date(),
    payload,
  });

  const endpoints = await tx.select({ id: webhookEndpoints.id })
    .from(webhookEndpoints)
    .where(and(
      eq(webhookEndpoints.tenantId, input.tenantId),
      eq(webhookEndpoints.status, "active"),
      arrayOverlaps(webhookEndpoints.eventTypes, [input.eventType]),
    ));

  if (endpoints.length === 0) return { eventId, deliveryIds: [] };

  const deliveries = endpoints.map((endpoint) => ({
    id: crypto.randomUUID(),
    tenantId: input.tenantId,
    endpointId: endpoint.id,
    eventId,
  }));
  await tx.insert(webhookDeliveries).values(deliveries);
  return { eventId, deliveryIds: deliveries.map((delivery) => delivery.id) };
}

export { assertSafePayload as assertSafeWebhookPayload };
