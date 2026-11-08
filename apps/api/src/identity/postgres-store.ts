import postgres from "postgres";
import type {
  AgentCredentialRecord,
  AgentRecord,
  BootstrapTenantInput,
  CreateAgentInput,
  CreateDeveloperInput,
  DeveloperCredentialRecord,
  IdentityStore,
  UserIdentityRecord
} from "./types.js";

type SqlClient = ReturnType<typeof postgres>;

export class PostgresIdentityStore implements IdentityStore {
  private readonly db: SqlClient;

  constructor(databaseUrl: string) {
    this.db = postgres(databaseUrl, { max: 10, prepare: false });
  }

  private async tenantTransaction<T>(tenantId: string, work: (tx: SqlClient) => Promise<T>): Promise<T> {
    return this.db.begin(async (transaction) => {
      const tx = transaction as unknown as SqlClient;
      await tx.unsafe("select set_config('app.tenant_id', $1, true)", [tenantId]);
      return work(tx);
    });
  }

  async healthCheck(): Promise<boolean> {
    const runtimeRole = await this.db.unsafe("select rolsuper, rolbypassrls from pg_roles where rolname = current_user");
    const role = runtimeRole[0] as { rolsuper?: boolean; rolbypassrls?: boolean } | undefined;
    if (!role || role.rolsuper || role.rolbypassrls) return false;
    const migrationTable = await this.db.unsafe("select to_regclass('public.schema_migrations') as table_name");
    const migrationTableName = (migrationTable[0] as { table_name?: string | null } | undefined)?.table_name;
    if (migrationTable.length !== 1 || !migrationTableName) return false;
    const applied = await this.db.unsafe("select version from schema_migrations where version = $1 limit 1", ["0002_identity_auth"]);
    if (applied.length !== 1) return false;
    const tenantTables = [
      "tenants", "users", "developers", "agents", "connected_accounts", "credentials",
      "delegations", "grants", "approvals", "executions", "audit_events",
      "developer_api_keys", "agent_credentials"
    ];
    const protectedTables = await this.db.unsafe(
      "select count(distinct c.relname)::int as count from pg_class c join pg_namespace n on n.oid = c.relnamespace join pg_policy p on p.polrelid = c.oid where n.nspname = 'public' and c.relname = any($1::text[]) and c.relrowsecurity and c.relforcerowsecurity and p.polname = 'tenant_isolation'",
      [tenantTables]
    );
    const protectedCount = (protectedTables[0] as { count?: number | string } | undefined)?.count;
    return Number(protectedCount ?? 0) === tenantTables.length;
  }

  async bootstrapTenant(input: BootstrapTenantInput): Promise<void> {
    await this.tenantTransaction(input.tenantId, async (tx) => {
      await tx.unsafe("insert into tenants (id, name, status) values ($1, $2, 'active')", [input.tenantId, input.tenantName]);
      await tx.unsafe(
        "insert into users (id, tenant_id, auth_issuer, auth_subject, role, status) values ($1, $2, $3, $4, 'owner', 'active')",
        [input.userId, input.tenantId, input.ownerIssuer, input.ownerSubject]
      );
      await tx.unsafe(
        "insert into developers (id, tenant_id, name, status) values ($1, $2, $3, 'active')",
        [input.developerId, input.tenantId, input.developerName]
      );
      await tx.unsafe(
        "insert into developer_api_keys (id, tenant_id, developer_id, secret_hash, scopes, expires_at) values ($1, $2, $3, $4, $5, $6)",
        [input.credential.id, input.tenantId, input.developerId, input.credential.secretHash, input.credential.scopes, input.credential.expiresAt]
      );
    });
  }

  async findDeveloperCredential(input: { tenantId: string; developerId: string; credentialId: string }): Promise<DeveloperCredentialRecord | null> {
    return this.tenantTransaction(input.tenantId, async (tx) => {
      const rows = await tx.unsafe(
        "select k.id, k.tenant_id as \"tenantId\", k.developer_id as \"developerId\", k.secret_hash as \"secretHash\", k.scopes, k.expires_at as \"expiresAt\", k.revoked_at as \"revokedAt\", d.status as \"developerStatus\", t.status as \"tenantStatus\" from developer_api_keys k join developers d on d.tenant_id = k.tenant_id and d.id = k.developer_id join tenants t on t.id = k.tenant_id where k.tenant_id = $1 and k.developer_id = $2 and k.id = $3 limit 1",
        [input.tenantId, input.developerId, input.credentialId]
      );
      return (rows[0] as unknown as DeveloperCredentialRecord | undefined) ?? null;
    });
  }

  async findAgentCredential(input: { tenantId: string; developerId: string; agentId: string; credentialId: string }): Promise<AgentCredentialRecord | null> {
    return this.tenantTransaction(input.tenantId, async (tx) => {
      const rows = await tx.unsafe(
        "select c.id, c.tenant_id as \"tenantId\", c.developer_id as \"developerId\", c.agent_id as \"agentId\", c.secret_hash as \"secretHash\", c.scopes, c.expires_at as \"expiresAt\", c.revoked_at as \"revokedAt\", a.status as \"agentStatus\", d.status as \"developerStatus\", t.status as \"tenantStatus\" from agent_credentials c join agents a on a.tenant_id = c.tenant_id and a.id = c.agent_id and a.developer_id = c.developer_id join developers d on d.tenant_id = c.tenant_id and d.id = c.developer_id join tenants t on t.id = c.tenant_id where c.tenant_id = $1 and c.developer_id = $2 and c.agent_id = $3 and c.id = $4 limit 1",
        [input.tenantId, input.developerId, input.agentId, input.credentialId]
      );
      return (rows[0] as unknown as AgentCredentialRecord | undefined) ?? null;
    });
  }

  async touchDeveloperCredential(input: { tenantId: string; developerId: string; credentialId: string }): Promise<boolean> {
    return this.tenantTransaction(input.tenantId, async (tx) => {
      const rows = await tx.unsafe(
        "update developer_api_keys k set last_used_at = now() from developers d, tenants t where k.tenant_id = $1 and k.developer_id = $2 and k.id = $3 and k.revoked_at is null and k.expires_at > now() and d.tenant_id = k.tenant_id and d.id = k.developer_id and d.status = 'active' and t.id = k.tenant_id and t.status = 'active' returning k.id",
        [input.tenantId, input.developerId, input.credentialId]
      );
      return rows.length === 1;
    });
  }

  async touchAgentCredential(input: { tenantId: string; developerId: string; agentId: string; credentialId: string }): Promise<boolean> {
    return this.tenantTransaction(input.tenantId, async (tx) => {
      const rows = await tx.unsafe(
        "update agent_credentials c set last_used_at = now() from agents a, developers d, tenants t where c.tenant_id = $1 and c.developer_id = $2 and c.agent_id = $3 and c.id = $4 and c.revoked_at is null and c.expires_at > now() and a.tenant_id = c.tenant_id and a.id = c.agent_id and a.developer_id = c.developer_id and a.status = 'active' and d.tenant_id = c.tenant_id and d.id = c.developer_id and d.status = 'active' and t.id = c.tenant_id and t.status = 'active' returning c.id",
        [input.tenantId, input.developerId, input.agentId, input.credentialId]
      );
      return rows.length === 1;
    });
  }

  async findUser(input: { tenantId: string; issuer: string; subject: string }): Promise<UserIdentityRecord | null> {
    return this.tenantTransaction(input.tenantId, async (tx) => {
      const rows = await tx.unsafe(
        "select u.id, u.tenant_id as \"tenantId\", u.role, u.status from users u join tenants t on t.id = u.tenant_id where u.tenant_id = $1 and u.auth_issuer = $2 and u.auth_subject = $3 and u.status = 'active' and t.status = 'active' limit 1",
        [input.tenantId, input.issuer, input.subject]
      );
      return (rows[0] as unknown as UserIdentityRecord | undefined) ?? null;
    });
  }

  async createDeveloper(input: CreateDeveloperInput): Promise<boolean> {
    return this.tenantTransaction(input.tenantId, async (tx) => {
      const owners = await tx.unsafe(
        "select u.id from users u join tenants t on t.id = u.tenant_id where u.tenant_id = $1 and u.id = $2 and u.status = 'active' and u.role in ('owner', 'admin') and t.status = 'active' limit 1",
        [input.tenantId, input.userId]
      );
      if (owners.length === 0) return false;
      await tx.unsafe(
        "insert into developers (id, tenant_id, name, status) values ($1, $2, $3, 'active')",
        [input.developerId, input.tenantId, input.developerName]
      );
      await tx.unsafe(
        "insert into developer_api_keys (id, tenant_id, developer_id, secret_hash, scopes, expires_at) values ($1, $2, $3, $4, $5, $6)",
        [input.credential.id, input.tenantId, input.developerId, input.credential.secretHash, input.credential.scopes, input.credential.expiresAt]
      );
      return true;
    });
  }

  async createAgent(input: CreateAgentInput): Promise<AgentRecord | null> {
    return this.tenantTransaction(input.tenantId, async (tx) => {
      const rows = await tx.unsafe(
        "insert into agents (id, tenant_id, developer_id, name, identity_type, status) select $1, d.tenant_id, d.id, $4, 'api_credential', 'active' from developers d join tenants t on t.id = d.tenant_id where d.tenant_id = $2 and d.id = $3 and d.status = 'active' and t.status = 'active' returning id, tenant_id as \"tenantId\", developer_id as \"developerId\", name, identity_type as \"identityType\", status, created_at as \"createdAt\"",
        [input.agentId, input.tenantId, input.developerId, input.name]
      );
      return (rows[0] as unknown as AgentRecord | undefined) ?? null;
    });
  }

  async listAgents(input: { tenantId: string; developerId: string }): Promise<AgentRecord[]> {
    return this.tenantTransaction(input.tenantId, async (tx) => {
      const rows = await tx.unsafe(
        "select id, tenant_id as \"tenantId\", developer_id as \"developerId\", name, identity_type as \"identityType\", status, created_at as \"createdAt\" from agents where tenant_id = $1 and developer_id = $2 order by created_at desc",
        [input.tenantId, input.developerId]
      );
      return rows as unknown as AgentRecord[];
    });
  }

  async getAgent(input: { tenantId: string; developerId: string; agentId: string }): Promise<AgentRecord | null> {
    return this.tenantTransaction(input.tenantId, async (tx) => {
      const rows = await tx.unsafe(
        "select id, tenant_id as \"tenantId\", developer_id as \"developerId\", name, identity_type as \"identityType\", status, created_at as \"createdAt\" from agents where tenant_id = $1 and developer_id = $2 and id = $3 limit 1",
        [input.tenantId, input.developerId, input.agentId]
      );
      return (rows[0] as unknown as AgentRecord | undefined) ?? null;
    });
  }

  async createAgentCredential(input: { tenantId: string; developerId: string; credential: { id: string; agentId: string; secretHash: Uint8Array; scopes: string[]; expiresAt: Date } }): Promise<boolean> {
    return this.tenantTransaction(input.tenantId, async (tx) => {
      const rows = await tx.unsafe(
        "insert into agent_credentials (id, tenant_id, developer_id, agent_id, secret_hash, scopes, expires_at) select $1, a.tenant_id, a.developer_id, a.id, $5, $6, $7 from agents a join developers d on d.tenant_id = a.tenant_id and d.id = a.developer_id join tenants t on t.id = a.tenant_id where a.tenant_id = $2 and a.developer_id = $3 and a.id = $4 and a.status = 'active' and d.status = 'active' and t.status = 'active' returning id",
        [input.credential.id, input.tenantId, input.developerId, input.credential.agentId, input.credential.secretHash, input.credential.scopes, input.credential.expiresAt]
      );
      return rows.length === 1;
    });
  }

  async revokeAgentCredential(input: { tenantId: string; developerId: string; agentId: string; credentialId: string }): Promise<boolean> {
    return this.tenantTransaction(input.tenantId, async (tx) => {
      const rows = await tx.unsafe(
        "update agent_credentials set revoked_at = now() where tenant_id = $1 and developer_id = $2 and agent_id = $3 and id = $4 and revoked_at is null returning id",
        [input.tenantId, input.developerId, input.agentId, input.credentialId]
      );
      return rows.length === 1;
    });
  }

  async rotateAgentCredential(input: { tenantId: string; developerId: string; agentId: string; oldCredentialId: string; credential: { id: string; agentId: string; secretHash: Uint8Array; scopes: string[]; expiresAt: Date } }): Promise<boolean> {
    return this.tenantTransaction(input.tenantId, async (tx) => {
      const existing = await tx.unsafe(
        "select id from agent_credentials where tenant_id = $1 and developer_id = $2 and agent_id = $3 and id = $4 and revoked_at is null and expires_at > now() for update",
        [input.tenantId, input.developerId, input.agentId, input.oldCredentialId]
      );
      if (existing.length !== 1) return false;
      const created = await tx.unsafe(
        "insert into agent_credentials (id, tenant_id, developer_id, agent_id, secret_hash, scopes, expires_at) select $1, a.tenant_id, a.developer_id, a.id, $5, $6, $7 from agents a join developers d on d.tenant_id = a.tenant_id and d.id = a.developer_id join tenants t on t.id = a.tenant_id where a.tenant_id = $2 and a.developer_id = $3 and a.id = $4 and a.status = 'active' and d.status = 'active' and t.status = 'active' returning id",
        [input.credential.id, input.tenantId, input.developerId, input.agentId, input.credential.secretHash, input.credential.scopes, input.credential.expiresAt]
      );
      if (created.length !== 1) return false;
      const revoked = await tx.unsafe(
        "update agent_credentials set revoked_at = now(), rotated_to_id = $5 where tenant_id = $1 and developer_id = $2 and agent_id = $3 and id = $4 and revoked_at is null returning id",
        [input.tenantId, input.developerId, input.agentId, input.oldCredentialId, input.credential.id]
      );
      if (revoked.length !== 1) throw new Error("credential_rotation_conflict");
      return true;
    });
  }

  async revokeDeveloperCredential(input: { tenantId: string; developerId: string; credentialId: string }): Promise<boolean> {
    return this.tenantTransaction(input.tenantId, async (tx) => {
      const rows = await tx.unsafe(
        "update developer_api_keys set revoked_at = now() where tenant_id = $1 and developer_id = $2 and id = $3 and revoked_at is null returning id",
        [input.tenantId, input.developerId, input.credentialId]
      );
      return rows.length === 1;
    });
  }

  async rotateDeveloperCredential(input: { tenantId: string; developerId: string; oldCredentialId: string; credential: { id: string; secretHash: Uint8Array; scopes: string[]; expiresAt: Date } }): Promise<boolean> {
    return this.tenantTransaction(input.tenantId, async (tx) => {
      const existing = await tx.unsafe(
        "select id from developer_api_keys where tenant_id = $1 and developer_id = $2 and id = $3 and revoked_at is null and expires_at > now() for update",
        [input.tenantId, input.developerId, input.oldCredentialId]
      );
      if (existing.length !== 1) return false;
      const created = await tx.unsafe(
        "insert into developer_api_keys (id, tenant_id, developer_id, secret_hash, scopes, expires_at) select $1, d.tenant_id, d.id, $4, $5, $6 from developers d join tenants t on t.id = d.tenant_id where d.tenant_id = $2 and d.id = $3 and d.status = 'active' and t.status = 'active' returning id",
        [input.credential.id, input.tenantId, input.developerId, input.credential.secretHash, input.credential.scopes, input.credential.expiresAt]
      );
      if (created.length !== 1) return false;
      const revoked = await tx.unsafe(
        "update developer_api_keys set revoked_at = now(), rotated_to_id = $4 where tenant_id = $1 and developer_id = $2 and id = $3 and revoked_at is null returning id",
        [input.tenantId, input.developerId, input.oldCredentialId, input.credential.id]
      );
      if (revoked.length !== 1) throw new Error("credential_rotation_conflict");
      return true;
    });
  }

  async close(): Promise<void> {
    await this.db.end({ timeout: 5 });
  }
}
