import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { createWorkerTicket } from "@agentlogin/execution";
import { credentialBrokerRoutes } from "./credential-broker.js";

const key = Buffer.alloc(32, 9);
const binding = { tenantId: "tenant_verified", executionId: "execution_verified", leaseId: "lease_verified" };
const consumed = {
  credentialRef: "vault_ref_internal", credentialId: "credential_internal", recordVersion: 3,
  tenantId: binding.tenantId, userId: "user_internal", agentId: "agent_internal",
  grantId: "grant_internal", accountId: "account_internal",
  origin: "https://accounts.example.com", executionId: binding.executionId
};

async function makeApp(consumer: { consume: ReturnType<typeof vi.fn> }) {
  const app = Fastify({ logger: false });
  const consumerForTenant = vi.fn((tenantId: string) => {
    expect(tenantId).toBe(binding.tenantId);
    return consumer;
  });
  await credentialBrokerRoutes(app, {
    database: {} as never, signingKey: key, consumerForTenant
  });
  return { app, consumerForTenant };
}

describe("internal credential broker boundary", () => {
  it("consumes only the lease bound to a verified worker ticket and returns opaque metadata", async () => {
    const consumer = { consume: vi.fn().mockResolvedValue(consumed) };
    const { app, consumerForTenant } = await makeApp(consumer);
    const ticket = createWorkerTicket(binding, key);
    const response = await app.inject({
      method: "POST", url: "/internal/v1/credential-leases/consume",
      headers: { authorization: "Bearer " + ticket },
      payload: { lease_id: binding.leaseId, token: "A".repeat(43) }
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual({
      lease_id: binding.leaseId, execution_id: binding.executionId,
      account_id: "account_internal", origin: "https://accounts.example.com",
      credential_ref: "vault_ref_internal", credential_id: "credential_internal",
      record_version: 3
    });
    expect(JSON.stringify(response.json())).not.toContain("password");
    expect(consumerForTenant).toHaveBeenCalledWith(binding.tenantId);
    expect(consumer.consume).toHaveBeenCalledWith({
      leaseId: binding.leaseId, token: "A".repeat(43)
    });
    await app.close();
  });

  it("rejects missing, invalid, and lease-mismatched worker tickets before consumption", async () => {
    const consumer = { consume: vi.fn() };
    const { app } = await makeApp(consumer);
    const ticket = createWorkerTicket(binding, key);
    const missing = await app.inject({
      method: "POST", url: "/internal/v1/credential-leases/consume",
      payload: { lease_id: binding.leaseId, token: "A".repeat(43) }
    });
    const invalid = await app.inject({
      method: "POST", url: "/internal/v1/credential-leases/consume",
      headers: { authorization: "Bearer " + (ticket.slice(0, -1) + (ticket.endsWith("x") ? "y" : "x")) },
      payload: { lease_id: binding.leaseId, token: "A".repeat(43) }
    });
    const mismatch = await app.inject({
      method: "POST", url: "/internal/v1/credential-leases/consume",
      headers: { authorization: "Bearer " + ticket },
      payload: { lease_id: "another_lease", token: "A".repeat(43) }
    });
    expect(missing.statusCode).toBe(401);
    expect(invalid.statusCode).toBe(401);
    expect(mismatch.statusCode).toBe(400);
    expect(consumer.consume).not.toHaveBeenCalled();
    await app.close();
  });

  it("does not return a lease if the consumed row belongs to another execution", async () => {
    const consumer = { consume: vi.fn().mockResolvedValue({ ...consumed, executionId: "other_execution" }) };
    const { app } = await makeApp(consumer);
    const ticket = createWorkerTicket(binding, key);
    const response = await app.inject({
      method: "POST", url: "/internal/v1/credential-leases/consume",
      headers: { authorization: "Bearer " + ticket },
      payload: { lease_id: binding.leaseId, token: "A".repeat(43) }
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("lease_not_found");
    await app.close();
  });
});
