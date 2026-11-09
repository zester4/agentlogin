import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "./client.js";
import { applicationAccessTokens, developerApplications, developerMemberships, developers, tenants } from "./schema.js";
import { withTenantTransaction } from "./tenant.js";

type DeveloperApplicationRecord = { applicationId: string; tenantId: string; developerId: string; clientSecretHash: Uint8Array; applicationStatus: "active" | "suspended" | "revoked"; developerStatus: "active" | "suspended" | "closed"; tenantStatus: "active" | "suspended" | "closed" };
type ApplicationAccessTokenRecord = { tokenId: string; tenantId: string; applicationId: string; developerId: string; tokenHash: Uint8Array; scopes: string[]; expiresAt: Date; revokedAt: Date | null; applicationStatus: "active" | "suspended" | "revoked"; developerStatus: "active" | "suspended" | "closed"; tenantStatus: "active" | "suspended" | "closed" };

export class PostgresApplicationCredentialRepository {
  constructor(private readonly database: Database, private readonly tenantId: string) {
    if (!tenantId || tenantId.trim() !== tenantId || tenantId.length > 200) throw new TypeError("A verified tenant identity is required.");
  }

  async insertApplication(input: { applicationId: string; tenantId: string; userId: string; developerId: string; name: string; clientId: string; clientSecretHash: Uint8Array }): Promise<void> {
    if (input.tenantId !== this.tenantId) throw new TypeError("Tenant mismatch.");
    await withTenantTransaction(this.database, this.tenantId, async (tx) => {
      const [membership] = await tx.select({ role: developerMemberships.role })
        .from(developerMemberships).innerJoin(developers, and(
          eq(developerMemberships.tenantId, developers.tenantId),
          eq(developerMemberships.developerId, developers.id)
        )).where(and(
          eq(developerMemberships.tenantId, this.tenantId),
          eq(developerMemberships.developerId, input.developerId),
          eq(developerMemberships.status, "active"),
          eq(developers.status, "active")
        )).limit(1);
      if (!membership || !["owner", "admin"].includes(membership.role)) throw new Error("Developer application management permission required.");
      await tx.insert(developerApplications).values({
        id: input.applicationId, tenantId: this.tenantId, developerId: input.developerId,
        name: input.name, clientId: input.clientId, clientSecretHash: Buffer.from(input.clientSecretHash), status: "active"
      });
    });
  }

  async findApplication(applicationId: string, tenantId: string): Promise<DeveloperApplicationRecord | null> {
    if (tenantId !== this.tenantId) return null;
    return withTenantTransaction(this.database, this.tenantId, async (tx) => {
      const [row] = await tx.select({
        applicationId: developerApplications.id, tenantId: developerApplications.tenantId,
        developerId: developerApplications.developerId, clientSecretHash: developerApplications.clientSecretHash,
        applicationStatus: developerApplications.status, developerStatus: developers.status,
        tenantStatus: tenants.status
      }).from(developerApplications)
        .innerJoin(developers, and(
          eq(developerApplications.tenantId, developers.tenantId),
          eq(developerApplications.developerId, developers.id)
        )).innerJoin(tenants, eq(developerApplications.tenantId, tenants.id))
        .where(and(eq(developerApplications.tenantId, this.tenantId), eq(developerApplications.id, applicationId)))
        .limit(1);
      return row ? { ...row, clientSecretHash: Buffer.from(row.clientSecretHash) } : null;
    });
  }

  async insertAccessToken(input: { tokenId: string; tenantId: string; applicationId: string; tokenHash: Uint8Array; scopes: string[]; expiresAt: Date }): Promise<void> {
    if (input.tenantId !== this.tenantId) throw new TypeError("Tenant mismatch.");
    await withTenantTransaction(this.database, this.tenantId, async (tx) => {
      await tx.insert(applicationAccessTokens).values({
        id: input.tokenId, tenantId: this.tenantId, applicationId: input.applicationId,
        tokenHash: Buffer.from(input.tokenHash), scopes: input.scopes, expiresAt: input.expiresAt
      });
    });
  }

  async findAccessToken(tokenId: string, tenantId: string): Promise<ApplicationAccessTokenRecord | null> {
    if (tenantId !== this.tenantId) return null;
    return withTenantTransaction(this.database, this.tenantId, async (tx) => {
      const [row] = await tx.select({
        tokenId: applicationAccessTokens.id, tenantId: applicationAccessTokens.tenantId,
        applicationId: applicationAccessTokens.applicationId, developerId: developerApplications.developerId, tokenHash: applicationAccessTokens.tokenHash,
        scopes: applicationAccessTokens.scopes, expiresAt: applicationAccessTokens.expiresAt,
        revokedAt: applicationAccessTokens.revokedAt, applicationStatus: developerApplications.status,
        developerStatus: developers.status, tenantStatus: tenants.status
      }).from(applicationAccessTokens)
        .innerJoin(developerApplications, and(
          eq(applicationAccessTokens.tenantId, developerApplications.tenantId),
          eq(applicationAccessTokens.applicationId, developerApplications.id)
        )).innerJoin(developers, and(
          eq(developerApplications.tenantId, developers.tenantId),
          eq(developerApplications.developerId, developers.id)
        )).innerJoin(tenants, eq(applicationAccessTokens.tenantId, tenants.id))
        .where(and(eq(applicationAccessTokens.tenantId, this.tenantId), eq(applicationAccessTokens.id, tokenId)))
        .limit(1);
      return row ? { ...row, tokenHash: Buffer.from(row.tokenHash) } : null;
    });
  }

  async updateAccessTokenLastUsed(tokenId: string, tenantId: string, at: Date): Promise<void> {
    if (tenantId !== this.tenantId) return;
    await withTenantTransaction(this.database, this.tenantId, async (tx) => {
      await tx.update(applicationAccessTokens).set({ lastUsedAt: at }).where(and(
        eq(applicationAccessTokens.tenantId, this.tenantId),
        eq(applicationAccessTokens.id, tokenId),
        isNull(applicationAccessTokens.revokedAt)
      ));
    });
  }
}
