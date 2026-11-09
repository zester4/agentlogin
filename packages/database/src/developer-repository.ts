import { randomBytes } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { Database } from "./client.js";
import { agentCredentials, agents, developerMemberships, developers } from "./schema.js";
import { withTenantTransaction } from "./tenant.js";

function newId(prefix: string): string { return prefix + "_" + randomBytes(18).toString("base64url"); }
export class PostgresDeveloperRepository {
  constructor(private readonly database: Database, private readonly tenantId: string) {
    if (!tenantId || tenantId.trim() !== tenantId || tenantId.length > 200) throw new TypeError("A verified tenant identity is required.");
  }

  async createDeveloper(input: { userId: string; name: string }): Promise<{ developerId: string }> {
    const developerId = newId("dev");
    await withTenantTransaction(this.database, this.tenantId, async (tx) => {
      await tx.insert(developers).values({ id: developerId, tenantId: this.tenantId, name: input.name, status: "active" });
      await tx.insert(developerMemberships).values({
        id: newId("dmem"), tenantId: this.tenantId, userId: input.userId,
        developerId, role: "owner", status: "active"
      });
    });
    return { developerId };
  }

  async createAgent(input: {
    userId: string; developerId: string; name: string; identityType: string;
  }): Promise<{ agentId: string }> {
    const agentId = newId("agt");
    await withTenantTransaction(this.database, this.tenantId, async (tx) => {
      const [membership] = await tx.select({ role: developerMemberships.role })
        .from(developerMemberships).innerJoin(developers, and(
          eq(developerMemberships.tenantId, developers.tenantId),
          eq(developerMemberships.developerId, developers.id)
        )).where(and(
          eq(developerMemberships.tenantId, this.tenantId),
          eq(developerMemberships.userId, input.userId),
          eq(developerMemberships.developerId, input.developerId),
          eq(developerMemberships.status, "active"),
          eq(developers.status, "active")
        )).limit(1);
      if (!membership || !["owner", "admin"].includes(membership.role)) throw new Error("Developer management permission required.");
      await tx.insert(agents).values({
        id: agentId, tenantId: this.tenantId, developerId: input.developerId,
        name: input.name, identityType: input.identityType, status: "active"
      });
    });
    return { agentId };
  }

  async listManagedAgents(userId: string) {
    return withTenantTransaction(this.database, this.tenantId, async (tx) => {
      return tx.select({
        agentId: agents.id,
        developerId: developers.id,
        developerName: developers.name,
        membershipRole: developerMemberships.role,
        name: agents.name,
        identityType: agents.identityType,
        status: agents.status,
        createdAt: agents.createdAt
      }).from(agents)
        .innerJoin(developerMemberships, and(
          eq(agents.tenantId, developerMemberships.tenantId),
          eq(agents.developerId, developerMemberships.developerId)
        ))
        .innerJoin(developers, and(
          eq(agents.tenantId, developers.tenantId),
          eq(agents.developerId, developers.id)
        ))
        .where(and(
          eq(agents.tenantId, this.tenantId),
          eq(developerMemberships.userId, userId),
          eq(developerMemberships.status, "active"),
          eq(developers.status, "active")
        ))
        .orderBy(desc(agents.createdAt))
        .limit(100);
    });
  }

  async getManagedAgent(userId: string, agentId: string): Promise<{ developerId: string } | null> {
    return withTenantTransaction(this.database, this.tenantId, async (tx) => {
      const [row] = await tx.select({ developerId: agents.developerId, role: developerMemberships.role })
        .from(agents).innerJoin(developerMemberships, and(
          eq(agents.tenantId, developerMemberships.tenantId),
          eq(agents.developerId, developerMemberships.developerId)
        )).innerJoin(developers, and(
          eq(agents.tenantId, developers.tenantId),
          eq(agents.developerId, developers.id)
        )).where(and(
          eq(agents.tenantId, this.tenantId), eq(agents.id, agentId),
          eq(agents.status, "active"), eq(developers.status, "active"),
          eq(developerMemberships.userId, userId),
          eq(developerMemberships.status, "active")
        )).limit(1);
      return row && ["owner", "admin"].includes(row.role) ? { developerId: row.developerId } : null;
    });
  }

  async suspendAgent(agentId: string): Promise<void> {
    await withTenantTransaction(this.database, this.tenantId, async (tx) => {
      const now = new Date();
      await tx.update(agents).set({ status: "suspended" }).where(and(
        eq(agents.tenantId, this.tenantId), eq(agents.id, agentId)
      ));
      await tx.update(agentCredentials).set({ revokedAt: now }).where(and(
        eq(agentCredentials.tenantId, this.tenantId),
        eq(agentCredentials.agentId, agentId), isNull(agentCredentials.revokedAt)
      ));
    });
  }

  async canManageAgent(userId: string, agentId: string): Promise<boolean> {
    return Boolean(await this.getManagedAgent(userId, agentId));
  }
}
