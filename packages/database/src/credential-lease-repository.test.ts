import { describe, expect, it } from "vitest";
import { hashCredentialLeaseToken, PostgresCredentialLeaseRepository } from "./credential-lease-repository.js";

describe("credential lease token handling", () => {
  it("stores a fixed-length SHA-256 digest rather than the opaque token", () => {
    const token = "A".repeat(43);
    const digest = hashCredentialLeaseToken(token);
    expect(digest).toBeInstanceOf(Buffer);
    expect(digest.byteLength).toBe(32);
    expect(digest.toString("base64url")).not.toBe(token);
    expect(hashCredentialLeaseToken(token)).toEqual(digest);
  });

  it("rejects malformed or non-opaque lease tokens", () => {
    expect(() => hashCredentialLeaseToken("password")).toThrow();
    expect(() => hashCredentialLeaseToken("A".repeat(42))).toThrow();
    expect(() => hashCredentialLeaseToken("A".repeat(44))).toThrow();
  });

  it("rejects a lease whose tenant differs from the authenticated tenant before database access", async () => {
    const repository = new PostgresCredentialLeaseRepository({} as never, "tenant_a");
    await expect(repository.issue({
      tenantId: "tenant_b", userId: "user_a", agentId: "agent_a",
      grantId: "grant_a", accountId: "account_a", credentialRef: "credential_a",
      credentialId: "credential-id-a", recordVersion: 1,
      origin: "https://accounts.example.com", executionId: "execution_a",
      expiresAt: new Date(Date.now() + 30_000),
    })).rejects.toThrow("Invalid credential lease binding");
  });

  it("rejects non-origin URLs and insecure non-local origins", async () => {
    const repository = new PostgresCredentialLeaseRepository({} as never, "tenant_a");
    const base = {
      tenantId: "tenant_a", userId: "user_a", agentId: "agent_a",
      grantId: "grant_a", accountId: "account_a", credentialRef: "credential_a",
      credentialId: "credential-id-a", recordVersion: 1,
      executionId: "execution_a", expiresAt: new Date(Date.now() + 30_000),
    };
    await expect(repository.issue({ ...base, origin: "https://accounts.example.com/login" }))
      .rejects.toThrow("Invalid credential lease binding");
    await expect(repository.issue({ ...base, origin: "http://accounts.example.com" }))
      .rejects.toThrow("Invalid credential lease binding");
  });
});
