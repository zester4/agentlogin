import { describe, expect, it } from "vitest";
import type { AgentCredentialRecord, AgentCredentialRepository, NewAgentCredential } from "./index.js";
import { AgentAuthenticationError, AgentCredentialService } from "./index.js";

class MemoryCredentials implements AgentCredentialRepository {
  readonly records = new Map<string, AgentCredentialRecord>();
  async insert(record: NewAgentCredential): Promise<void> {
    this.records.set(record.credentialId, { ...record, revokedAt: null, tenantStatus: "active", developerStatus: "active", agentStatus: "active" });
  }
  async rotate(record: NewAgentCredential): Promise<void> {
    for (const existing of this.records.values()) {
      if (existing.tenantId === record.tenantId && existing.agentId === record.agentId && existing.revokedAt === null) {
        existing.revokedAt = record.createdAt;
      }
    }
    await this.insert(record);
  }
  async findById(id: string): Promise<AgentCredentialRecord | null> { return this.records.get(id) ?? null; }
  async revoke(id: string, tenant: string, at: Date): Promise<void> {
    const record = this.records.get(id);
    if (record?.tenantId === tenant) record.revokedAt = at;
  }
}
const now = () => new Date("2026-11-07T12:00:00.000Z");
const key = Buffer.alloc(32, 7);

describe("opaque agent credentials", () => {
  it("stores only a token hash and authenticates the database-bound principal", async () => {
    const repo = new MemoryCredentials();
    const service = new AgentCredentialService(repo, key, now);
    const issued = await service.issue({ tenantId: "ten_1", developerId: "dev_1", agentId: "agt_1", expiresAt: new Date("2026-11-08T12:00:00Z") });
    const stored = repo.records.get(issued.credentialId)!;
    expect(issued.token).toMatch(/^al_agent_/);
    expect(Buffer.from(stored.tokenHash).toString("utf8")).not.toContain(issued.token);
    await expect(service.authenticate(issued.token)).resolves.toEqual({
      tenantId: "ten_1", developerId: "dev_1", agentId: "agt_1", credentialId: issued.credentialId
    });
  });

  it("rejects a modified token without querying the repository", async () => {
    const repo = new MemoryCredentials();
    const service = new AgentCredentialService(repo, key, now);
    const issued = await service.issue({ tenantId: "ten_1", developerId: "dev_1", agentId: "agt_1", expiresAt: new Date("2026-11-08T12:00:00Z") });
    const changed = issued.token.slice(0, -1) + (issued.token.endsWith("A") ? "B" : "A");
    await expect(service.authenticate(changed)).rejects.toBeInstanceOf(AgentAuthenticationError);
    expect(repo.records.size).toBe(1);
  });

  it("rejects tokens signed with a different key", async () => {
    const repo = new MemoryCredentials();
    const issuer = new AgentCredentialService(repo, key, now);
    const issued = await issuer.issue({ tenantId: "ten_1", developerId: "dev_1", agentId: "agt_1", expiresAt: new Date("2026-11-08T12:00:00Z") });
    const verifier = new AgentCredentialService(repo, Buffer.alloc(32, 8), now);
    await expect(verifier.authenticate(issued.token)).rejects.toBeInstanceOf(AgentAuthenticationError);
  });

  it("rejects a tenant-claim substitution", async () => {
    const repo = new MemoryCredentials();
    const service = new AgentCredentialService(repo, key, now);
    const issued = await service.issue({ tenantId: "ten_1", developerId: "dev_1", agentId: "agt_1", expiresAt: new Date("2026-11-08T12:00:00Z") });
    const parts = issued.token.split(".");
    parts[1] = Buffer.from("ten_2").toString("base64url");
    await expect(service.authenticate(parts.join("."))).rejects.toBeInstanceOf(AgentAuthenticationError);
  });

  it("rejects expired issuance", async () => {
    const service = new AgentCredentialService(new MemoryCredentials(), key, now);
    await expect(service.issue({ tenantId: "ten_1", developerId: "dev_1", agentId: "agt_1", expiresAt: new Date("2026-11-07T11:59:59Z") })).rejects.toBeInstanceOf(TypeError);
  });

  it("rejects revoked credentials", async () => {
    const service = new AgentCredentialService(new MemoryCredentials(), key, now);
    const issued = await service.issue({ tenantId: "ten_1", developerId: "dev_1", agentId: "agt_1", expiresAt: new Date("2026-11-08T12:00:00Z") });
    await service.revoke(issued.credentialId, "ten_1");
    await expect(service.authenticate(issued.token)).rejects.toBeInstanceOf(AgentAuthenticationError);
  });

  it("rejects suspended agents", async () => {
    const repo = new MemoryCredentials();
    const service = new AgentCredentialService(repo, key, now);
    const issued = await service.issue({ tenantId: "ten_1", developerId: "dev_1", agentId: "agt_1", expiresAt: new Date("2026-11-08T12:00:00Z") });
    repo.records.get(issued.credentialId)!.agentStatus = "suspended";
    await expect(service.authenticate(issued.token)).rejects.toBeInstanceOf(AgentAuthenticationError);
  });

  it("atomically revokes previous credentials when rotating an agent token", async () => {
    const repo = new MemoryCredentials();
    const service = new AgentCredentialService(repo, key, now);
    const first = await service.issue({ tenantId: "ten_1", developerId: "dev_1", agentId: "agt_1", expiresAt: new Date("2026-11-08T12:00:00Z") });
    const second = await service.rotate({ tenantId: "ten_1", developerId: "dev_1", agentId: "agt_1", expiresAt: new Date("2026-11-08T12:00:00Z") });
    await expect(service.authenticate(first.token)).rejects.toBeInstanceOf(AgentAuthenticationError);
    await expect(service.authenticate(second.token)).resolves.toMatchObject({ agentId: "agt_1" });
  });

  it("requires a 256-bit signing key", () => {
    expect(() => new AgentCredentialService(new MemoryCredentials(), Buffer.alloc(31), now)).toThrow("32 bytes");
  });
});
