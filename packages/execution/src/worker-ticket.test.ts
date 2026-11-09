import { describe, expect, it } from "vitest";
import { createWorkerTicket, verifyWorkerTicket } from "./worker-ticket.js";

const key = Buffer.alloc(32, 7);
const now = new Date("2026-11-09T12:00:00.000Z");
const binding = { tenantId: "tenant_a", executionId: "execution_a", leaseId: "lease_a" };

describe("short-lived worker tickets", () => {
  it("signs and verifies an execution- and lease-bound ticket", () => {
    const token = createWorkerTicket(binding, key, { now, ttlSeconds: 30 });
    expect(verifyWorkerTicket(token, key, { now })).toMatchObject({
      ...binding, issuedAt: 1794225600, expiresAt: 1794225630
    });
  });

  it("rejects tampering and a different signing key", () => {
    const token = createWorkerTicket(binding, key, { now });
    const [header, payload, sig] = token.split(".");
    expect(() => verifyWorkerTicket(header + "." + payload + "." + sig.slice(0, -1) + "A", key, { now })).toThrow();
    expect(() => verifyWorkerTicket(token, Buffer.alloc(32, 8), { now })).toThrow();
  });

  it("rejects expired, future-issued and overlong tickets", () => {
    const token = createWorkerTicket(binding, key, { now, ttlSeconds: 1 });
    expect(() => verifyWorkerTicket(token, key, { now: new Date(now.getTime() + 1000) })).toThrow();
    expect(() => createWorkerTicket(binding, key, { now, ttlSeconds: 61 })).toThrow();
    expect(() => createWorkerTicket(binding, Buffer.alloc(16), { now })).toThrow();
  });

  it("rejects malformed or incomplete identities", () => {
    expect(() => createWorkerTicket({ ...binding, tenantId: "" }, key, { now })).toThrow();
    expect(() => verifyWorkerTicket("not-a-jwt", key, { now })).toThrow();
  });
});
