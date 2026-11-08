import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { issueAgentCredential, issueDeveloperCredential, newId } from "../identity/credentials.js";
import type {
  AgentCredentialRecord,
  AgentRecord,
  DeveloperCredentialRecord,
  IdentityStore,
  UserIdentityRecord
} from "../identity/types.js";
import type { UserTokenVerifier } from "../identity/user-jwt.js";

const tenantA = newId("ten");
const tenantB = newId("ten");
const developerA = newId("dev");
const developerB = newId("dev");
const agentA = newId("agt");
const agentB = newId("agt");
const ownerUser = newId("usr");

class MemoryIdentityStore {
  developerKeys = new Map<string, DeveloperCredentialRecord>();
  agentKeys = new Map<string, AgentCredentialRecord>();
  agents = new Map<string, AgentRecord>();
  users = new Map<string, UserIdentityRecord>();

  async healthCheck() { return true; }
  async bootstrapTenant() {}
  async findDeveloperCredential(input: { tenantId: string; developerId: string; credentialId: string }) {
    const row = this.developerKeys.get(input.credentialId);
    if (!row || row.tenantId !== input.tenantId || row.developerId !== input.developerId) return null;
    return row;
  }
  async findAgentCredential(input: { tenantId: string; developerId: string; agentId: string; credentialId: string }) {
    const row = this.agentKeys.get(input.credentialId);
    if (!row || row.tenantId !== input.tenantId || row.developerId !== input.developerId || row.agentId !== input.agentId) return null;
    return row;
  }
  async touchDeveloperCredential(input: { tenantId: string; developerId: string; credentialId: string }) {
    const row = this.developerKeys.get(input.credentialId);
    return Boolean(row && row.tenantId === input.tenantId && row.developerId === input.developerId &&
      row.revokedAt === null && row.expiresAt.getTime() > Date.now() &&
      row.developerStatus === "active" && row.tenantStatus === "active");
  }
  async touchAgentCredential(input: { tenantId: string; developerId: string; agentId: string; credentialId: string }) {
    const row = this.agentKeys.get(input.credentialId);
    return Boolean(row && row.tenantId === input.tenantId && row.developerId === input.developerId &&
      row.agentId === input.agentId && row.revokedAt === null && row.expiresAt.getTime() > Date.now() &&
      row.agentStatus === "active" && row.developerStatus === "active" && row.tenantStatus === "active");
  }
  async findUser(input: { tenantId: string; issuer: string; subject: string }) {
    return this.users.get(input.tenantId + ":" + input.issuer + ":" + input.subject) ?? null;
  }
  async createDeveloper() { return true; }
  async createAgent(input: { tenantId: string; developerId: string; agentId: string; name: string }) {
    const row: AgentRecord = {
      id: input.agentId, tenantId: input.tenantId, developerId: input.developerId,
      name: input.name, identityType: "api_credential", status: "active", createdAt: new Date()
    };
    this.agents.set(row.id, row);
    return row;
  }
  async listAgents(input: { tenantId: string; developerId: string }) {
    return [...this.agents.values()].filter((row) => row.tenantId === input.tenantId && row.developerId === input.developerId);
  }
  async getAgent(input: { tenantId: string; developerId: string; agentId: string }) {
    const row = this.agents.get(input.agentId);
    if (!row || row.tenantId !== input.tenantId || row.developerId !== input.developerId) return null;
    return row;
  }
  async createAgentCredential(input: { tenantId: string; developerId: string; credential: { id: string; agentId: string; secretHash: Uint8Array; scopes: string[]; expiresAt: Date } }) {
    const owned = await this.getAgent({ tenantId: input.tenantId, developerId: input.developerId, agentId: input.credential.agentId });
    if (!owned) return false;
    this.agentKeys.set(input.credential.id, {
      id: input.credential.id, tenantId: input.tenantId, developerId: input.developerId,
      agentId: input.credential.agentId, secretHash: input.credential.secretHash,
      scopes: input.credential.scopes, expiresAt: input.credential.expiresAt,
      revokedAt: null, agentStatus: "active", developerStatus: "active", tenantStatus: "active"
    });
    return true;
  }
  async revokeAgentCredential(input: { tenantId: string; developerId: string; agentId: string; credentialId: string }) {
    const row = await this.findAgentCredential(input);
    if (!row || row.revokedAt) return false;
    row.revokedAt = new Date();
    return true;
  }
  async rotateAgentCredential(input: { tenantId: string; developerId: string; agentId: string; oldCredentialId: string; credential: { id: string; agentId: string; secretHash: Uint8Array; scopes: string[]; expiresAt: Date } }) {
    const old = await this.findAgentCredential({ tenantId: input.tenantId, developerId: input.developerId, agentId: input.agentId, credentialId: input.oldCredentialId });
    if (!old || old.revokedAt) return false;
    old.revokedAt = new Date();
    return this.createAgentCredential({
      tenantId: input.tenantId,
      developerId: input.developerId,
      credential: input.credential
    });
  }
  async revokeDeveloperCredential(input: { tenantId: string; developerId: string; credentialId: string }) {
    const row = this.developerKeys.get(input.credentialId);
    if (!row || row.tenantId !== input.tenantId || row.developerId !== input.developerId || row.revokedAt) return false;
    row.revokedAt = new Date();
    return true;
  }
  async rotateDeveloperCredential(input: { tenantId: string; developerId: string; oldCredentialId: string; credential: { id: string; secretHash: Uint8Array; scopes: string[]; expiresAt: Date } }) {
    const old = this.developerKeys.get(input.oldCredentialId);
    if (!old || old.tenantId !== input.tenantId || old.developerId !== input.developerId || old.revokedAt) return false;
    old.revokedAt = new Date();
    this.developerKeys.set(input.credential.id, {
      id: input.credential.id, tenantId: input.tenantId, developerId: input.developerId,
      secretHash: input.credential.secretHash, scopes: input.credential.scopes,
      expiresAt: input.credential.expiresAt, revokedAt: null,
      developerStatus: "active", tenantStatus: "active"
    });
    return true;
  }
  async close() {}
}

function setup() {
  const store = new MemoryIdentityStore();
  const developerKey = issueDeveloperCredential(tenantA, developerA);
  store.developerKeys.set(developerKey.id, {
    id: developerKey.id, tenantId: tenantA, developerId: developerA,
    secretHash: developerKey.secretHash, scopes: developerKey.scopes,
    expiresAt: developerKey.expiresAt, revokedAt: null,
    developerStatus: "active", tenantStatus: "active"
  });
  const agentKey = issueAgentCredential(tenantA, developerA, agentA, ["agent:read"]);
  store.agents.set(agentA, {
    id: agentA, tenantId: tenantA, developerId: developerA, name: "Primary agent",
    identityType: "api_credential", status: "active", createdAt: new Date()
  });
  store.agents.set(agentB, {
    id: agentB, tenantId: tenantB, developerId: developerB, name: "Other tenant agent",
    identityType: "api_credential", status: "active", createdAt: new Date()
  });
  store.agentKeys.set(agentKey.id, {
    id: agentKey.id, tenantId: tenantA, developerId: developerA, agentId: agentA,
    secretHash: agentKey.secretHash, scopes: agentKey.scopes, expiresAt: agentKey.expiresAt,
    revokedAt: null, agentStatus: "active", developerStatus: "active", tenantStatus: "active"
  });
  const issuer = "https://identity.example.test";
  store.users.set(tenantA + ":" + issuer + ":subject-a", {
    id: ownerUser, tenantId: tenantA, role: "owner", status: "active"
  });
  const verifier: UserTokenVerifier = {
    issuer,
    verify: (token: string) => {
      if (token === "user-a") return {
        tenantId: tenantA, issuer, subject: "subject-a", expiresAt: new Date(Date.now() + 60_000)
      };
      if (token === "user-wrong") return {
        tenantId: tenantA, issuer, subject: "subject-b", expiresAt: new Date(Date.now() + 60_000)
      };
      throw new Error("invalid");
    }
  };
  const app = buildApp({
    identityStore: store as unknown as IdentityStore,
    userTokenVerifier: verifier,
    bootstrapSecret: "bootstrap-test-secret"
  });
  return { app, store, developerKey, agentKey };
}

describe("identity and tenant isolation routes", () => {
  it("fails closed when developer authentication is missing", async () => {
    const { app } = setup();
    const response = await app.inject({ method: "GET", url: "/v1/developer/me" });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("fails closed when agent authentication is missing", async () => {
    const { app } = setup();
    const response = await app.inject({ method: "GET", url: "/v1/agent/me" });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("allows only the configured operator secret to bootstrap a tenant and returns the developer key once", async () => {
    const { app, issuer } = setup();
    const response = await app.inject({
      method: "POST",
      url: "/v1/bootstrap/tenants",
      headers: { "x-agentlogin-bootstrap-secret": "bootstrap-test-secret" },
      payload: {
        tenant_name: "Synthetic tenant",
        developer_name: "Synthetic developer",
        owner_issuer: issuer,
        owner_subject: "new-owner-subject"
      }
    });
    expect(response.statusCode).toBe(201);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json().tenant_id).toMatch(/^ten_/);
    expect(response.json().developer_key).toMatch(/^ald_/);
    const denied = await app.inject({
      method: "POST",
      url: "/v1/bootstrap/tenants",
      headers: { "x-agentlogin-bootstrap-secret": "wrong-secret" },
      payload: {
        tenant_name: "Another tenant",
        developer_name: "Another developer",
        owner_issuer: issuer,
        owner_subject: "another-owner"
      }
    });
    expect(denied.statusCode).toBe(401);
    await app.close();
  });

  it("does not allow a developer to read an agent owned by another tenant", async () => {
    const { app, developerKey } = setup();
    const response = await app.inject({
      method: "GET",
      url: "/v1/agents/" + agentB,
      headers: { authorization: "Bearer " + developerKey.token }
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it("rejects a user identity that is not a member of the tenant in the signed token", async () => {
    const { app } = setup();
    const response = await app.inject({
      method: "GET",
      url: "/v1/user/me",
      headers: { authorization: "Bearer user-wrong" }
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("rejects an agent credential presented for a different agent identity", async () => {
    const { app, agentKey } = setup();
    const wrongAgentToken = agentKey.token.replace(agentA, agentB);
    const response = await app.inject({
      method: "GET",
      url: "/v1/agent/me",
      headers: { authorization: "Bearer " + wrongAgentToken }
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("rejects revoked and expired agent credentials on every request", async () => {
    const { app, store, agentKey } = setup();
    const row = store.agentKeys.get(agentKey.id)!;
    row.revokedAt = new Date();
    const revoked = await app.inject({
      method: "GET", url: "/v1/agent/me",
      headers: { authorization: "Bearer " + agentKey.token }
    });
    expect(revoked.statusCode).toBe(401);
    row.revokedAt = null;
    row.expiresAt = new Date(Date.now() - 1000);
    const expired = await app.inject({
      method: "GET", url: "/v1/agent/me",
      headers: { authorization: "Bearer " + agentKey.token }
    });
    expect(expired.statusCode).toBe(401);
    await app.close();
  });

  it("rotates an agent credential and rejects the old credential", async () => {
    const { app, developerKey, agentKey } = setup();
    const rotated = await app.inject({
      method: "POST",
      url: "/v1/agents/" + agentA + "/credentials/" + agentKey.id + "/rotate",
      headers: { authorization: "Bearer " + developerKey.token },
      payload: {}
    });
    expect(rotated.statusCode).toBe(200);
    expect(rotated.headers["cache-control"]).toBe("no-store");
    const newToken = rotated.json().agent_credential as string;
    expect(newToken).toBeTruthy();

    const oldAttempt = await app.inject({
      method: "GET", url: "/v1/agent/me",
      headers: { authorization: "Bearer " + agentKey.token }
    });
    const newAttempt = await app.inject({
      method: "GET", url: "/v1/agent/me",
      headers: { authorization: "Bearer " + newToken }
    });
    expect(oldAttempt.statusCode).toBe(401);
    expect(newAttempt.statusCode).toBe(200);
    expect(JSON.stringify(newAttempt.json())).not.toContain(newToken);
    await app.close();
  });

  it("rotates a developer key and invalidates the old key", async () => {
    const { app, developerKey } = setup();
    const rotated = await app.inject({
      method: "POST",
      url: "/v1/developer-keys/" + developerKey.id + "/rotate",
      headers: { authorization: "Bearer " + developerKey.token }
    });
    expect(rotated.statusCode).toBe(200);
    expect(rotated.headers["cache-control"]).toBe("no-store");
    const newToken = rotated.json().developer_key as string;
    const oldAttempt = await app.inject({
      method: "GET", url: "/v1/developer/me",
      headers: { authorization: "Bearer " + developerKey.token }
    });
    const newAttempt = await app.inject({
      method: "GET", url: "/v1/developer/me",
      headers: { authorization: "Bearer " + newToken }
    });
    expect(oldAttempt.statusCode).toBe(401);
    expect(newAttempt.statusCode).toBe(200);
    await app.close();
  });

  it("derives the user tenant from a verified identity token and active membership", async () => {
    const { app } = setup();
    const response = await app.inject({
      method: "GET",
      url: "/v1/user/me",
      headers: { authorization: "Bearer user-a" }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ tenant_id: tenantA, user_id: ownerUser, role: "owner" });
    await app.close();
  });

  it("allows only a tenant owner to provision a developer key without accepting a tenant ID", async () => {
    const { app } = setup();
    const response = await app.inject({
      method: "POST",
      url: "/v1/developers",
      headers: { authorization: "Bearer user-a" },
      payload: { name: "Billing integration" }
    });
    expect(response.statusCode).toBe(201);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json().developer_key).toMatch(/^ald_/);
    expect(response.json()).not.toHaveProperty("tenant_id");
    const spoofed = await app.inject({
      method: "POST",
      url: "/v1/developers",
      headers: { authorization: "Bearer user-a" },
      payload: { name: "Cross-tenant project", tenant_id: tenantB }
    });
    expect(spoofed.statusCode).toBe(400);
    await app.close();
  });

  it("rejects caller-supplied tenant IDs instead of using request-body tenancy", async () => {
    const { app, developerKey } = setup();
    const response = await app.inject({
      method: "POST",
      url: "/v1/agents",
      headers: { authorization: "Bearer " + developerKey.token },
      payload: { name: "Spoof attempt", tenant_id: tenantB }
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("creates agents only inside the authenticated developer tenant", async () => {
    const { app, developerKey } = setup();
    const response = await app.inject({
      method: "POST",
      url: "/v1/agents",
      headers: { authorization: "Bearer " + developerKey.token },
      payload: { name: "Tenant A agent" }
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().agent_id).toMatch(/^agt_/);
    await app.close();
  });

  it("returns only safe identity metadata to an authenticated agent", async () => {
    const { app, agentKey } = setup();
    const response = await app.inject({
      method: "GET",
      url: "/v1/agent/me",
      headers: { authorization: "Bearer " + agentKey.token }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).not.toHaveProperty("secret_hash");
    expect(response.json()).not.toHaveProperty("agent_credential");
    expect(JSON.stringify(response.json())).not.toContain(agentKey.token);
    await app.close();
  });
});
