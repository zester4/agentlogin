import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  connectedAccounts, createDatabase, developers, enqueueWebhookEvent, tenants, users, webhookDeliveryQueue,
  webhookDeliveries, webhookEndpoints, webhookEvents, withTenantTransaction,
} from "./index.js";

const connectionString = process.env.TEST_DATABASE_URL;
const integration = describe.skipIf(!connectionString);

integration("transactional webhook outbox", () => {
  let handle: ReturnType<typeof createDatabase> | undefined;

  beforeAll(() => {
    if (!connectionString) throw new Error("TEST_DATABASE_URL is required");
    handle = createDatabase(connectionString);
  });

  afterAll(async () => {
    await handle?.close();
  });

  it("commits event, delivery and queue together; rolls all back on failure", async () => {
    if (!handle) throw new Error("Database integration handle was not initialized");
    const suffix = crypto.randomUUID();
    const tenantId = `outbox-tenant-${suffix}`;
    const developerId = `outbox-developer-${suffix}`;
    const userId = `outbox-user-${suffix}`;
    const accountId = `outbox-account-${suffix}`;
    const endpointId = `outbox-endpoint-${suffix}`;
    const eventId = `outbox-event-${suffix}`;

    await withTenantTransaction(handle.db, tenantId, async (tx) => {
      await tx.insert(tenants).values({ id: tenantId, name: "Outbox integration tenant" });
      await tx.insert(users).values({ id: userId, tenantId, authSubject: `outbox-subject-${suffix}` });
      await tx.insert(developers).values({ id: developerId, tenantId, name: "Outbox integration developer" });
      await tx.insert(connectedAccounts).values({ id: accountId, tenantId, userId, provider: "synthetic", origin: "https://example.test", displayLabel: "Outbox account", status: "active" });
      await tx.insert(webhookEndpoints).values({
        id: endpointId, tenantId, developerId, url: "https://hooks.example.test/events",
        eventTypes: ["grant.requested", "connected_account.disconnected"], status: "active",
        secretCiphertext: Buffer.from("ciphertext"), secretIv: Buffer.alloc(12),
        secretAuthTag: Buffer.alloc(16), wrappedDek: Buffer.from("wrapped-dek"), keyVersion: "test",
      });
    });

    const inserted = new Promise<void>((resolve) => { signalInserted = resolve; });
    const continueCommit = new Promise<void>((resolve) => { allowCommit = resolve; });
    const transaction = withTenantTransaction(handle.db, tenantId, async (tx) => {
      await enqueueWebhookEvent(tx, {
        tenantId, eventId, eventType: "connected_account.disconnected", resourceType: "connected_account",
        resourceId: accountId, payload: { account_id: accountId },
      });
      signalInserted();
      await continueCommit;
    });

    await inserted;
    const observer = await handle.pool.connect();
    try {
      await observer.query("BEGIN");
      await observer.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      const beforeCommit = await observer.query(
        "SELECT (SELECT count(*) FROM webhook_events WHERE id = $1) AS events, " +
        "(SELECT count(*) FROM webhook_deliveries WHERE event_id = $1) AS deliveries, " +
        "(SELECT count(*) FROM webhook_delivery_queue q JOIN webhook_deliveries d " +
        "ON d.tenant_id = q.tenant_id AND d.id = q.delivery_id WHERE d.event_id = $1) AS queued",
        [eventId],
      );
      expect(beforeCommit.rows[0]).toEqual({ events: "0", deliveries: "0", queued: "0" });
      await observer.query("COMMIT");
    } finally {
      observer.release();
    }

    allowCommit();
    await transaction;

    await withTenantTransaction(handle.db, tenantId, async (tx) => {
      const [event] = await tx.select({ id: webhookEvents.id }).from(webhookEvents)
        .where(eq(webhookEvents.id, eventId));
      const deliveries = await tx.select({ id: webhookDeliveries.id }).from(webhookDeliveries)
        .where(eq(webhookDeliveries.eventId, eventId));
      const queue = await tx.select({ id: webhookDeliveryQueue.id }).from(webhookDeliveryQueue)
        .where(eq(webhookDeliveryQueue.tenantId, tenantId));
      expect(event?.id).toBe(eventId);
      expect(deliveries).toHaveLength(1);
      expect(queue).toHaveLength(1);
    });

    const rollbackEventId = eventId + "-rollback";
    await expect(withTenantTransaction(handle.db, tenantId, async (tx) => {
      await tx.update(connectedAccounts).set({ status: "disabled" }).where(eq(connectedAccounts.id, accountId));
      await enqueueWebhookEvent(tx, {
        tenantId, eventId: rollbackEventId, eventType: "connected_account.disconnected",
        resourceType: "connected_account", resourceId: accountId,
        payload: { account_id: accountId },
      });
      throw new Error("injected failure after outbox enqueue");
    })).rejects.toThrow("injected failure after outbox enqueue");

    await withTenantTransaction(handle.db, tenantId, async (tx) => {
      const [event] = await tx.select({ id: webhookEvents.id }).from(webhookEvents)
        .where(eq(webhookEvents.id, rollbackEventId));
      const deliveries = await tx.select({ id: webhookDeliveries.id }).from(webhookDeliveries)
        .where(eq(webhookDeliveries.eventId, rollbackEventId));
      const [account] = await tx.select({ status: connectedAccounts.status }).from(connectedAccounts)
        .where(eq(connectedAccounts.id, accountId));
      expect(event).toBeUndefined();
      expect(deliveries).toHaveLength(0);
      expect(account?.status).toBe("active");
    });
  });

  it("rejects a caller-supplied tenant that differs from the transaction RLS context", async () => {
    if (!handle) throw new Error("Database integration handle was not initialized");
    const suffix = crypto.randomUUID();
    const tenantA = `outbox-context-a-${suffix}`;
    const tenantB = `outbox-context-b-${suffix}`;
    await withTenantTransaction(handle.db, tenantA, async (tx) => {
      await expect(enqueueWebhookEvent(tx, {
        tenantId: tenantB, eventType: "grant.requested", resourceType: "grant",
        resourceId: "cross-tenant-grant", payload: { grant_id: "cross-tenant-grant" },
      })).rejects.toThrow("Webhook tenant context mismatch.");
    });
    await withTenantTransaction(handle.db, tenantA, async (tx) => {
      const rows = await tx.select({ id: webhookEvents.id }).from(webhookEvents)
        .where(eq(webhookEvents.resourceId, "cross-tenant-grant"));
      expect(rows).toHaveLength(0);
    });
  });

  it("does not expose one tenant's outbox rows to another tenant", async () => {
    if (!handle) throw new Error("Database integration handle was not initialized");
    const suffix = crypto.randomUUID();
    const tenantA = `outbox-isolation-a-${suffix}`;
    const tenantB = `outbox-isolation-b-${suffix}`;
    const eventId = `outbox-isolation-event-${suffix}`;
    await withTenantTransaction(handle.db, tenantA, async (tx) => {
      await tx.insert(tenants).values({ id: tenantA, name: "Outbox isolation A" });
      await enqueueWebhookEvent(tx, {
        tenantId: tenantA, eventId, eventType: "grant.requested",
        resourceType: "grant", resourceId: "tenant-a-grant",
        payload: { grant_id: "tenant-a-grant" },
      });
    });
    await withTenantTransaction(handle.db, tenantB, async (tx) => {
      const rows = await tx.select({ id: webhookEvents.id }).from(webhookEvents)
        .where(eq(webhookEvents.id, eventId));
      expect(rows).toHaveLength(0);
    });
  });
});

let signalInserted: () => void = () => {};
let allowCommit: () => void = () => {};
