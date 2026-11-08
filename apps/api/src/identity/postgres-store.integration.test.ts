import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { issueAgentCredential, issueDeveloperCredential, newId } from "./credentials.js";
import { PostgresIdentityStore } from "./postgres-store.js";
import { IdentityService } from "./service.js";
import type { UserTokenVerifier } from "./user-jwt.js";

const configuredDatabaseUrl = process.env.AGENTLOGIN_TEST_DATABASE_URL;
const integrationSuite = configuredDatabaseUrl ? describe : describe.skip;

integrationSuite("PostgreSQL identity integration", () => {
  // A harmless fallback keeps the skipped suite declarable when no test database is configured.
  const databaseUrl = configuredDatabaseUrl ?? "postgres://agentlogin:agentlogin@127.0.0.1:1/agentlogin";
  const store = new PostgresIdentityStore(databaseUrl);
  const direct = postgres(databaseUrl, { max: 1, prepare: false });

  const tenantA = newId("ten");
  const tenantB = newId("ten");
  const developerA = newId("dev");
  const developerB = newId("dev");
  const agentA = newId("agt");
  const agentB = newId("agt");
  const issuer = "https://identity.example.test";
  const ownerSubjectA = "synthetic-integration-owner-a";
  const ownerSubjectB = "synthetic-integration-owner-b";
  const developerKeyA = issueDeveloperCredential(tenantA, developerA);
  const developerKeyB = issueDeveloperCredential(tenantB, developerB);
  const agentKeyA = issueAgentCredential(tenantA, developerA, agentA, ["agent:read"]);
  const agentKeyB = issueAgentCredential(tenantB, developerB, agentB, ["agent:read"]);

  beforeAll(async () => {
    await store.bootstrapTenant({
      tenantId: tenantA,
      tenantName: "Synthetic integration tenant A",
      userId: newId("usr"),
      ownerIssuer: issuer,
      ownerSubject: ownerSubjectA,
      developerId: developerA,
      developerName: "Synthetic integration developer A",
      credential: developerKeyA
    });
    await store.bootstrapTenant({
      tenantId: tenantB,
      tenantName: "Synthetic integration tenant B",
      userId: newId("usr"),
      ownerIssuer: issuer,
      ownerSubject: ownerSubjectB,
      developerId: developerB,
      developerName: "Synthetic integration developer B",
      credential: developerKeyB
    });

    const createdA = await store.createAgent({
      tenantId: tenantA,
      developerId: developerA,
      agentId: agentA,
      name: "Synthetic agent A"
    });
    const createdB = await store.createAgent({
      tenantId: tenantB,
      developerId: developerB,
      agentId: agentB,
      name: "Synthetic agent B"
    });
    expect(createdA).not.toBeNull();
    expect(createdB).not.toBeNull();
    expect(await store.createAgentCredential({
      tenantId: tenantA,
      developerId: developerA,
      credential: agentKeyA
    })).toBe(true);
    expect(await store.createAgentCredential({
      tenantId: tenantB,
      developerId: developerB,
      credential: agentKeyB
    })).toBe(true);
  });

  afterAll(async () => {
    await store.close();
    await direct.end({ timeout: 5 });
  });

  it("enforces forced RLS for tenant reads and writes using the non-superuser runtime role", async () => {
    expect(await store.healthCheck()).toBe(true);

    const withoutTenantContext = await direct.unsafe("select id from tenants");
    expect(withoutTenantContext).toHaveLength(0);

    const hiddenTenantRows = await direct.begin(async (tx) => {
      await tx.unsafe("select set_config('app.tenant_id', $1, true)", [tenantA]);
      return tx.unsafe("select id from agents where tenant_id = $1", [tenantB]);
    });
    expect(hiddenTenantRows).toHaveLength(0);

    await expect(direct.begin(async (tx) => {
      await tx.unsafe("select set_config('app.tenant_id', $1, true)", [tenantA]);
      await tx.unsafe(
        "insert into agents (id, tenant_id, developer_id, name, identity_type, status) values ($1, $2, $3, $4, 'api_credential', 'active')",
        [newId("agt"), tenantB, developerB, "Cross-tenant spoof"]
      );
    })).rejects.toThrow();

    expect(await store.getAgent({
      tenantId: tenantB,
      developerId: developerB,
      agentId: agentA
    })).toBeNull();
    expect(await store.listAgents({ tenantId: tenantB, developerId: developerB })).toHaveLength(1);
  });

  it("authenticates database-backed user, developer, and agent principals and enforces ownership and lifecycle", async () => {
    const userVerifier: UserTokenVerifier = {
      issuer,
      verify: () => ({
        tenantId: tenantA,
        issuer,
        subject: ownerSubjectA,
        expiresAt: new Date(Date.now() + 60_000)
      })
    };
    const identity = new IdentityService(store, userVerifier);
    expect(await identity.authenticateUser("synthetic-user-token")).toMatchObject({
      kind: "user",
      tenantId: tenantA,
      issuer,
      subject: ownerSubjectA
    });

    const wrongUserIdentity = new IdentityService(store, {
      issuer,
      verify: () => ({
        tenantId: tenantB,
        issuer,
        subject: ownerSubjectA,
        expiresAt: new Date(Date.now() + 60_000)
      })
    });
    expect(await wrongUserIdentity.authenticateUser("synthetic-user-token")).toBeNull();

    expect(await identity.authenticateDeveloper(developerKeyA.token)).toMatchObject({
      kind: "developer",
      tenantId: tenantA,
      developerId: developerA
    });
    expect(await identity.authenticateDeveloper(developerKeyA.token.replace(tenantA, tenantB))).toBeNull();

    expect(await identity.authenticateAgent(agentKeyA.token)).toMatchObject({
      kind: "agent",
      tenantId: tenantA,
      developerId: developerA,
      agentId: agentA
    });
    expect(await identity.authenticateAgent(agentKeyA.token.replace(agentA, agentB))).toBeNull();
    expect(await identity.authenticateAgent(agentKeyA.token.replace(tenantA, tenantB))).toBeNull();

    const rotatedAgentKey = issueAgentCredential(tenantA, developerA, agentA, ["agent:read"]);
    expect(await store.rotateAgentCredential({
      tenantId: tenantA,
      developerId: developerA,
      agentId: agentA,
      oldCredentialId: agentKeyA.id,
      credential: rotatedAgentKey
    })).toBe(true);
    expect(await identity.authenticateAgent(agentKeyA.token)).toBeNull();
    expect(await identity.authenticateAgent(rotatedAgentKey.token)).not.toBeNull();
    expect(await store.revokeAgentCredential({
      tenantId: tenantA,
      developerId: developerA,
      agentId: agentA,
      credentialId: rotatedAgentKey.id
    })).toBe(true);
    expect(await identity.authenticateAgent(rotatedAgentKey.token)).toBeNull();

    const rotatedDeveloperKey = issueDeveloperCredential(tenantA, developerA);
    expect(await store.rotateDeveloperCredential({
      tenantId: tenantA,
      developerId: developerA,
      oldCredentialId: developerKeyA.id,
      credential: rotatedDeveloperKey
    })).toBe(true);
    expect(await identity.authenticateDeveloper(developerKeyA.token)).toBeNull();
    expect(await identity.authenticateDeveloper(rotatedDeveloperKey.token)).not.toBeNull();
    expect(await store.revokeDeveloperCredential({
      tenantId: tenantA,
      developerId: developerA,
      credentialId: rotatedDeveloperKey.id
    })).toBe(true);
    expect(await identity.authenticateDeveloper(rotatedDeveloperKey.token)).toBeNull();
  });
});
