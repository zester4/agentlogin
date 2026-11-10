import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  agents, connectedAccounts, createDatabase, developers, PostgresConnectedAccountRepository,
  PostgresCredentialRecordStore, PostgresExecutionRepository, PostgresGrantRepository, tenants, users,
  webhookDeliveryQueue, webhookDeliveries, webhookEndpoints, webhookEvents,
  withTenantTransaction,
} from "./index.js";

const connectionString = process.env.TEST_DATABASE_URL;
const integration = describe.skipIf(!connectionString);

integration("domain lifecycle webhook outbox integration", () => {
  let handle: ReturnType<typeof createDatabase> | undefined;
  beforeAll(() => {
    if (!connectionString) throw new Error("TEST_DATABASE_URL is required");
    handle = createDatabase(connectionString);
  });
  afterAll(async () => { await handle?.close(); });

  it("records grant, approval, execution and account-disconnection events in their domain transactions", async () => {
    if (!handle) throw new Error("Database integration handle was not initialized");
    const suffix = crypto.randomUUID();
    const tenantId = `domain-outbox-tenant-${suffix}`;
    const userId = `domain-outbox-user-${suffix}`;
    const developerId = `domain-outbox-developer-${suffix}`;
    const agentId = `domain-outbox-agent-${suffix}`;
    const endpointId = `domain-outbox-endpoint-${suffix}`;
    const repository = new PostgresConnectedAccountRepository(handle.db, tenantId);
    const grants = new PostgresGrantRepository(handle.db, tenantId);

    await withTenantTransaction(handle.db, tenantId, async (tx) => {
      await tx.insert(tenants).values({ id: tenantId, name: "Domain outbox integration tenant" });
      await tx.insert(users).values({ id: userId, tenantId, authSubject: `subject-${suffix}` });
      await tx.insert(developers).values({ id: developerId, tenantId, name: "Domain outbox developer" });
      await tx.insert(agents).values({ id: agentId, tenantId, developerId, name: "Outbox test agent", identityType: "service" });
      await tx.insert(webhookEndpoints).values({
        id: endpointId, tenantId, developerId, url: "https://hooks.example.test/events",
        eventTypes: ["connected_account.created", "connected_account.disconnected",
          "connected_account.disabled", "grant.requested", "grant.approved", "grant.denied",
          "grant.revoked", "execution.completed", "connected_account.connected", "credential.rotated"],
        status: "active", secretCiphertext: Buffer.from("ciphertext"),
        secretIv: Buffer.alloc(12), secretAuthTag: Buffer.alloc(16),
        wrappedDek: Buffer.from("wrapped-dek"), keyVersion: "test",
      });
    });

    await repository.create({ userId, provider: "synthetic", origin: "https://example.test", displayLabel: "Synthetic account" });
    const accountRows = await withTenantTransaction(handle.db, tenantId, async (tx) =>
      tx.select({ id: connectedAccounts.id }).from(connectedAccounts)
        .where(eq(connectedAccounts.tenantId, tenantId)));
    expect(accountRows).toHaveLength(1);
    const actualAccountId = accountRows[0]!.id;

    const credentialStore = new PostgresCredentialRecordStore(handle.db, tenantId);
    const previousContext = {
      tenantId, accountId: actualAccountId, credentialId: `credential-one-${suffix}`,
      recordVersion: 1, purpose: "website_login" as const,
    };
    await credentialStore.insert({
      credentialRef: `credential-ref-one-${suffix}`, context: previousContext,
      envelope: { algorithm: "AES-256-GCM", aadVersion: 1,
        ciphertext: new Uint8Array([1, 2, 3]), iv: new Uint8Array(12),
        authTag: new Uint8Array(16), wrappedDek: new Uint8Array([4, 5]), keyVersion: "test" },
      revokedAt: null,
    });
    await credentialStore.rotate(`credential-ref-one-${suffix}`, previousContext, {
      credentialRef: `credential-ref-two-${suffix}`,
      context: { ...previousContext, credentialId: `credential-two-${suffix}`, recordVersion: 2 },
      envelope: { algorithm: "AES-256-GCM", aadVersion: 1,
        ciphertext: new Uint8Array([6, 7, 8]), iv: new Uint8Array(12),
        authTag: new Uint8Array(16), wrappedDek: new Uint8Array([9, 10]), keyVersion: "test" },
      revokedAt: null,
    }, new Date());

    const grantInput = {
      id: `grt-${suffix}`, tenantId, userId, agentId, accountId: actualAccountId,
      origin: "https://example.test", scopes: ["login"], taskId: null, policyVersion: 1,
      issuedAt: new Date(), expiresAt: new Date(Date.now() + 60_000),
      requestedBy: agentId, createdAt: new Date(),
    };
    const created = await grants.createPending(grantInput);
    expect(created.grantId).toBe(grantInput.id);
    await expect(grants.decide({
      approvalId: created.approvalId, userId, decision: "approved", decidedAt: new Date(),
    })).resolves.toBe(true);

    await new PostgresExecutionRepository(handle.db, tenantId).append({
      executionId: `exe-${suffix}`, tenantId, agentId, grantId: created.grantId,
      accountId: actualAccountId, origin: "https://example.test", status: "login_succeeded",
      startedAt: new Date(Date.now() - 1000), completedAt: new Date(),
    });
    await new PostgresExecutionRepository(handle.db, tenantId).append({
      executionId: `exe-failed-${suffix}`, tenantId, agentId, grantId: created.grantId,
      accountId: actualAccountId, origin: "https://example.test", status: "login_failed",
      reasonCode: "site_unavailable", startedAt: new Date(Date.now() - 1000), completedAt: new Date(),
    });

    const deniedGrant = await grants.createPending({
      ...grantInput, id: `grt-denied-${suffix}`, issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000), createdAt: new Date(),
    });
    await expect(grants.decide({
      approvalId: deniedGrant.approvalId, userId, decision: "denied", decidedAt: new Date(),
    })).resolves.toBe(true);
    const secondGrant = await grants.createPending({
      ...grantInput, id: `grt-disconnect-${suffix}`, issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000), createdAt: new Date(),
    });
    await repository.disconnect(actualAccountId, userId);
    const failedEnrollment = await repository.create({
      userId, provider: "synthetic", origin: "https://example.test", displayLabel: "Failed enrollment",
    });
    await repository.disable(failedEnrollment.accountId, userId);

    const expected = [
      "connected_account.created", "connected_account.connected", "credential.rotated",
      "grant.requested", "grant.approved", "execution.completed", "execution.completed", "grant.requested",
      "grant.denied", "grant.requested", "connected_account.disconnected",
      "grant.revoked", "grant.revoked", "grant.revoked", "connected_account.created", "connected_account.disabled",
    ];
    await withTenantTransaction(handle.db, tenantId, async (tx) => {
      const events = await tx.select({ eventType: webhookEvents.eventType })
        .from(webhookEvents).where(eq(webhookEvents.tenantId, tenantId));
      expect(events.map((event) => event.eventType).sort()).toEqual([...expected].sort());
      const deliveries = await tx.select({ id: webhookDeliveries.id })
        .from(webhookDeliveries).where(eq(webhookDeliveries.tenantId, tenantId));
      const queue = await tx.select({ id: webhookDeliveryQueue.id })
        .from(webhookDeliveryQueue).where(eq(webhookDeliveryQueue.tenantId, tenantId));
      expect(deliveries).toHaveLength(expected.length);
      expect(queue).toHaveLength(expected.length);
    });
    expect(secondGrant.grantId).toBe(`grt-disconnect-${suffix}`);
  });

  it("does not emit another approval or revocation event for repeated transitions", async () => {
    if (!handle) throw new Error("Database integration handle was not initialized");
    const suffix = crypto.randomUUID();
    const tenantId = `domain-outbox-repeat-${suffix}`;
    const userId = `domain-outbox-repeat-user-${suffix}`;
    const developerId = `domain-outbox-repeat-dev-${suffix}`;
    const agentId = `domain-outbox-repeat-agent-${suffix}`;
    const accountId = `domain-outbox-repeat-account-${suffix}`;
    const grants = new PostgresGrantRepository(handle.db, tenantId);
    await withTenantTransaction(handle.db, tenantId, async (tx) => {
      await tx.insert(tenants).values({ id: tenantId, name: "Repeat transition tenant" });
      await tx.insert(users).values({ id: userId, tenantId, authSubject: `subject-${suffix}` });
      await tx.insert(developers).values({ id: developerId, tenantId, name: "Repeat developer" });
      await tx.insert(agents).values({ id: agentId, tenantId, developerId, name: "Repeat agent", identityType: "service" });
      await tx.insert(connectedAccounts).values({
        id: accountId, tenantId, userId, provider: "synthetic", origin: "https://example.test",
        displayLabel: "Repeat account", status: "active",
      });
      await tx.insert(webhookEndpoints).values({
        id: `repeat-endpoint-${suffix}`, tenantId, developerId,
        url: "https://hooks.example.test/events", eventTypes: ["grant.requested", "grant.approved", "grant.revoked"],
        status: "active", secretCiphertext: Buffer.from("ciphertext"),
        secretIv: Buffer.alloc(12), secretAuthTag: Buffer.alloc(16),
        wrappedDek: Buffer.from("wrapped-dek"), keyVersion: "test",
      });
    });
    const input = {
      id: `repeat-grant-${suffix}`, tenantId, userId, agentId, accountId,
      origin: "https://example.test", scopes: ["login"], taskId: null, policyVersion: 1,
      issuedAt: new Date(), expiresAt: new Date(Date.now() + 60_000),
      requestedBy: agentId, createdAt: new Date(),
    };
    const created = await grants.createPending(input);
    await expect(grants.decide({ approvalId: created.approvalId, userId, decision: "approved", decidedAt: new Date() })).resolves.toBe(true);
    await expect(grants.decide({ approvalId: created.approvalId, userId, decision: "approved", decidedAt: new Date() })).resolves.toBe(false);
    await expect(grants.revoke(created.grantId, new Date(), userId)).resolves.toBe(true);
    await expect(grants.revoke(created.grantId, new Date(), userId)).resolves.toBe(false);
    await withTenantTransaction(handle.db, tenantId, async (tx) => {
      const rows = await tx.select({ eventType: webhookEvents.eventType }).from(webhookEvents)
        .where(eq(webhookEvents.tenantId, tenantId));
      expect(rows.map((row) => row.eventType).sort()).toEqual(["grant.approved", "grant.requested", "grant.revoked"]);
    });
  });
});
