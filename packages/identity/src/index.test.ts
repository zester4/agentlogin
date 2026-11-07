import { describe, expect, it } from "vitest";
import type { AgentCredentialRecord, AgentCredentialRepository, NewAgentCredential } from "./index.js";
import { AgentAuthenticationError, AgentCredentialService } from "./index.js";

class MemoryCredentials implements AgentCredentialRepository {
  readonly records = new Map<string, AgentCredentialRecord>();
  async insert(record: NewAgentCredential): Promise<void> {
    this.records.set(record.credentialId, { ...record, revokedAt: null, tenantStatus: "active", developerStatus: "active", agentStatus: "active" });
  }
  async findById(id: string): Promise<AgentCredentialRecord | null> { return this.records.get(id) ?? null; }
  async revoke(id: string, tenant: string, at: Date): Promise<void> {
    const record = this.records.get(id);
    if (record?.tenantId === tenant) record.revokedAt = at;
  }
}
const now = () => new Date("2026-11-07T12:00:00.000Z");

describe("opaque agent credentials", () => {
  it("stores only a token hash and authenticates the database-bound principal", async () => {
    const repo = new MemoryCredentials();
    const service = new AgentCredentialService(repo, now);
    const issued = await service.issue({ tenantId: "ten_1", developerId: "dev_1", agentId: "agt_1", expiresAt: new Date("2026-11-08T12:00:00Z") });
    const stored = repo.records.get(issued.credentialId)!;
    expect(issued.token).toMatch(/^al_agent_/);
    expect(Buffer.from(stored.tokenHash).toString("utf8")).not.toContain(issued.token);
    await expect(service.authenticate(issued.token)).resolves.toEqual({
      tenantId: "ten_1", developerId: "dev_1", agentId: "agt_1", credentialId: issued.credentialId
    });
  });

  it("rejects a modified token", async () => {
    const service = new AgentCredentialService(new MemoryCredentials(), now);
    const issued = await service.issue({ tenantId: "ten_1", developerId: "dev_1", agentId: "agt_1", expiresAt: new Date("2026-11-08T12:00:00Z") });
    const changed = issued.token.slice(0, -1) + (issued.token.endsWith("A") ? "B" : "A");
    await expect(service.authenticate(changed)).rejects.toBeInstanceOf(AgentAuthenticationError);
  });

  it("rejects expired issuance", async () => {
    const service = new AgentCredentialService(new MemoryCredentials(), now);
    await expect(service.issue({ tenantId: "ten_1", developerId: "dev_1", agentId: "agt_1", expiresAt: new Date("2026-11-07T11:59:59Z") }))
      .rejects.toBeInstanceOf(TypeError);
  });

  it("rejects revoked credentials", async () => {
    const service = new AgentCredentialService(new MemoryCredentials(), now);
    const issued = await service.issue({ tenantId: "ten_1", developerId: "dev_1", agentId: "agt_1", expiresAt: new Date("2026-11-08T12:00:00Z") });
    await service.revoke(issued.credentialId, "ten_1");
    await expect(service.authenticate(issued.token)).rejects.toBeInstanceOf(AgentAuthenticationError);
  });

  it("rejects suspended agents", async () => {
    const repo = new MemoryCredentials();
    const service = new AgentCredentialService(repo, now);
    const issued = await service.issue({ tenantId: "ten_1", developerId: "dev_1", agentId: "agt_1", expiresAt: new Date("2026-11-08T12:00:00Z") });
    repo.records.get(issued.credentialId)!.agentStatus = "suspended";
    await expect(service.authenticate(issued.token)).rejects.toBeInstanceOf(AgentAuthenticationError);
  });
});
