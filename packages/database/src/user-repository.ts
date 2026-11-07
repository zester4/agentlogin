import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { Database } from "./client.js";
import { developerMemberships, developers, tenants, users } from "./schema.js";
import { withTenantTransaction } from "./tenant.js";

export type AuthenticatedUser = { tenantId: string; userId: string; authSubject: string };
function id(prefix: string): string { return prefix + "_" + randomBytes(18).toString("base64url"); }
function safeLabel(value: string | undefined, fallback: string): string {
  const normalized = (value ?? "").trim().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 120);
  return normalized || fallback;
}

/**
 * OIDC subject + tenant claim are accepted only after JWT signature, issuer,
 * audience, expiry, and algorithm verification in the API layer. This
 * repository then resolves that identity under tenant RLS.
 */
export class PostgresUserRepository {
  constructor(private readonly database: Database, private readonly authenticatedTenantId: string) {
    if (!authenticatedTenantId || authenticatedTenantId.trim() !== authenticatedTenantId || authenticatedTenantId.length > 200) {
      throw new TypeError("A verified tenant identity is required.");
    }
  }

  async findActiveBySubject(authSubject: string): Promise<AuthenticatedUser | null> {
    if (!authSubject || authSubject.length > 255) return null;
    return withTenantTransaction(this.database, this.authenticatedTenantId, async (tx) => {
      const [row] = await tx.select({ id: users.id, authSubject: users.authSubject, status: users.status })
        .from(users).where(and(
          eq(users.tenantId, this.authenticatedTenantId),
          eq(users.authSubject, authSubject),
          eq(users.status, "active")
        )).limit(1);
      return row ? { tenantId: this.authenticatedTenantId, userId: row.id, authSubject: row.authSubject } : null;
    });
  }
}

export class PostgresOnboardingRepository {
  constructor(private readonly database: Database) {}

  async onboard(input: {
    tenantId: string; authSubject: string; userName?: string;
    tenantName?: string; developerName?: string;
  }): Promise<{ tenantId: string; userId: string; developerId: string; membershipRole: "owner" }> {
    if (!input.tenantId || input.tenantId.trim() !== input.tenantId || input.tenantId.length > 200 ||
        !input.authSubject || input.authSubject.length > 255) {
      throw new TypeError("A verified OIDC tenant and subject are required.");
    }
    return withTenantTransaction(this.database, input.tenantId, async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.tenantId + ":" + input.authSubject}))`);
      await tx.insert(tenants).values({
        id: input.tenantId, name: safeLabel(input.tenantName, "Workspace"), status: "active"
      }).onConflictDoNothing();
      const [tenant] = await tx.select({ id: tenants.id, status: tenants.status })
        .from(tenants).where(eq(tenants.id, input.tenantId)).limit(1);
      if (!tenant || tenant.status !== "active") throw new Error("Workspace is not active.");

      await tx.insert(users).values({
        id: id("usr"), tenantId: input.tenantId, authSubject: input.authSubject, status: "active"
      }).onConflictDoNothing();
      const [user] = await tx.select({ id: users.id, status: users.status })
        .from(users).where(and(
          eq(users.tenantId, input.tenantId), eq(users.authSubject, input.authSubject)
        )).limit(1);
      if (!user || user.status !== "active") throw new Error("User is not active.");

      const [existingMembership] = await tx.select({ developerId: developerMemberships.developerId })
        .from(developerMemberships).where(and(
          eq(developerMemberships.tenantId, input.tenantId),
          eq(developerMemberships.userId, user.id),
          eq(developerMemberships.status, "active")
        )).limit(1);
      if (existingMembership) {
        return { tenantId: input.tenantId, userId: user.id, developerId: existingMembership.developerId, membershipRole: "owner" };
      }

      const developerId = id("dev");
      await tx.insert(developers).values({
        id: developerId, tenantId: input.tenantId,
        name: safeLabel(input.developerName, safeLabel(input.userName, "My developer workspace")),
        status: "active"
      });
      await tx.insert(developerMemberships).values({
        id: id("dmem"), tenantId: input.tenantId, userId: user.id,
        developerId, role: "owner", status: "active"
      });
      return { tenantId: input.tenantId, userId: user.id, developerId, membershipRole: "owner" };
    });
  }
}
