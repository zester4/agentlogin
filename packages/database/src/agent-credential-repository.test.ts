import { describe, expect, it, vi } from "vitest";
import type { Database } from "./client.js";
import { PostgresAgentCredentialRepository } from "./agent-credential-repository.js";

describe("PostgresAgentCredentialRepository", () => {
  it("requires a verified tenant context at construction", () => {
    const database = {} as Database;
    expect(() => new PostgresAgentCredentialRepository(database, "")).toThrow(
      "verified tenant identity",
    );
    expect(() => new PostgresAgentCredentialRepository(database, " tenant-a")).toThrow(
      "verified tenant identity",
    );
  });

  it("rejects cross-tenant inserts before opening a database transaction", async () => {
    const transaction = vi.fn();
    const database = { transaction } as unknown as Database;
    const repository = new PostgresAgentCredentialRepository(database, "tenant-a");

    await expect(
      repository.insert({
        credentialId: "cred_1",
        tenantId: "tenant-b",
        developerId: "dev_1",
        agentId: "agt_1",
        tokenHash: new Uint8Array(32),
        createdAt: new Date("2026-11-07T00:00:00.000Z"),
        expiresAt: new Date("2026-11-08T00:00:00.000Z"),
      }),
    ).rejects.toThrow("Tenant context mismatch.");

    expect(transaction).not.toHaveBeenCalled();
  });

  it("does not query the database for an empty credential reference", async () => {
    const transaction = vi.fn();
    const database = { transaction } as unknown as Database;
    const repository = new PostgresAgentCredentialRepository(database, "tenant-a");

    await expect(repository.findById("")).resolves.toBeNull();
    expect(transaction).not.toHaveBeenCalled();
  });
});
