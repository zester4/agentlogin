import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  createDatabase,
  developerMemberships,
  developers,
  PostgresUserRepository,
  tenants,
  users,
  withTenantTransaction,
} from "@agentlogin/database";

const connectionString = process.env.TEST_DATABASE_URL;
const integration = describe.skipIf(!connectionString);

integration("authenticated user membership isolation", () => {
  let handle: ReturnType<typeof createDatabase> | undefined;

  beforeAll(() => {
    if (!connectionString) throw new Error("TEST_DATABASE_URL is required");
    handle = createDatabase(connectionString);
  });

  afterAll(async () => {
    await handle?.close();
  });

  it("requires an active developer membership and cannot resolve another tenant's subject", async () => {
    if (!handle) throw new Error("Database integration handle was not initialized");

    const suffix = crypto.randomUUID();
    const tenantA = `oidc-membership-a-${suffix}`;
    const tenantB = `oidc-membership-b-${suffix}`;
    const userA = `oidc-user-a-${suffix}`;
    const userB = `oidc-user-b-${suffix}`;
    const developerA = `oidc-developer-a-${suffix}`;
    const developerB = `oidc-developer-b-${suffix}`;
    const membershipA = `oidc-membership-row-a-${suffix}`;
    const membershipB = `oidc-membership-row-b-${suffix}`;
    const subjectA = `auth0|tenant-a-${suffix}`;
    const subjectB = `auth0|tenant-b-${suffix}`;

    try {
      await withTenantTransaction(handle.db, tenantA, async (tx) => {
        await tx.insert(tenants).values({ id: tenantA, name: "Synthetic OIDC tenant A" });
        await tx.insert(users).values({ id: userA, tenantId: tenantA, authSubject: subjectA, status: "active" });
        await tx.insert(developers).values({ id: developerA, tenantId: tenantA, name: "Synthetic developer A", status: "active" });
        await tx.insert(developerMemberships).values({
          id: membershipA, tenantId: tenantA, userId: userA, developerId: developerA, role: "owner", status: "active",
        });
      });
      await withTenantTransaction(handle.db, tenantB, async (tx) => {
        await tx.insert(tenants).values({ id: tenantB, name: "Synthetic OIDC tenant B" });
        await tx.insert(users).values({ id: userB, tenantId: tenantB, authSubject: subjectB, status: "active" });
        await tx.insert(developers).values({ id: developerB, tenantId: tenantB, name: "Synthetic developer B", status: "active" });
        await tx.insert(developerMemberships).values({
          id: membershipB, tenantId: tenantB, userId: userB, developerId: developerB, role: "owner", status: "active",
        });
      });

      const repositoryA = new PostgresUserRepository(handle.db, tenantA);
      expect(await repositoryA.findActiveBySubject(subjectA)).toEqual({
        tenantId: tenantA, userId: userA, authSubject: subjectA,
      });
      expect(await repositoryA.findActiveBySubject(subjectB)).toBeNull();

      await withTenantTransaction(handle.db, tenantA, async (tx) => {
        await tx.update(developerMemberships).set({ status: "inactive" })
          .where(and(eq(developerMemberships.tenantId, tenantA), eq(developerMemberships.id, membershipA)));
      });
      expect(await repositoryA.findActiveBySubject(subjectA)).toBeNull();
    } finally {
      await withTenantTransaction(handle.db, tenantA, async (tx) => {
        await tx.delete(developerMemberships).where(eq(developerMemberships.tenantId, tenantA));
        await tx.delete(developers).where(eq(developers.tenantId, tenantA));
        await tx.delete(users).where(eq(users.tenantId, tenantA));
        await tx.delete(tenants).where(eq(tenants.id, tenantA));
      });
      await withTenantTransaction(handle.db, tenantB, async (tx) => {
        await tx.delete(developerMemberships).where(eq(developerMemberships.tenantId, tenantB));
        await tx.delete(developers).where(eq(developers.tenantId, tenantB));
        await tx.delete(users).where(eq(users.tenantId, tenantB));
        await tx.delete(tenants).where(eq(tenants.id, tenantB));
      });
    }
  });
});
