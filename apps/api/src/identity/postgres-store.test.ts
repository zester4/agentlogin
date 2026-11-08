import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationUrl = new URL("../../../../db/migrations/0002_identity_auth.sql", import.meta.url);
const storeUrl = new URL("./postgres-store.ts", import.meta.url);

describe("PostgreSQL identity isolation contract", () => {
  it("forces tenant RLS on identity and tenant-owned tables", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    expect(sql).toContain("FORCE ROW LEVEL SECURITY");
    expect(sql).toContain("current_setting(''app.tenant_id'', true)");
    for (const table of ["users", "developers", "agents", "developer_api_keys", "agent_credentials"]) {
      expect(sql).toContain("'" + table + "'");
    }
  });

  it("defines a tenant-qualified grant key before approval and execution references", async () => {
    const sql = await readFile(new URL("../../../../db/migrations/0001_initial.sql", import.meta.url), "utf8");
    const grantsDefinition = sql.split("CREATE TABLE grants (")[1]?.split(");")[0] ?? "";
    const grantReferences = sql.split("FOREIGN KEY(tenant_id,grant_id) REFERENCES grants(tenant_id,id)").length - 1;
    expect(grantsDefinition).toContain("UNIQUE(tenant_id,id)");
    expect(grantReferences).toBe(2);
  });

  it("enforces agent credential ownership with a composite foreign key", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    expect(sql).toContain("FOREIGN KEY (tenant_id, agent_id, developer_id)");
    expect(sql).toContain("UNIQUE (tenant_id, id, developer_id)");
  });

  it("binds credential rotation references to the same tenant, developer, and agent", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    expect(sql).toContain("UNIQUE (tenant_id, developer_id, id)");
    expect(sql).toContain("FOREIGN KEY (tenant_id, developer_id, rotated_to_id)");
    expect(sql).toContain("UNIQUE (tenant_id, developer_id, agent_id, id)");
    expect(sql).toContain("FOREIGN KEY (tenant_id, developer_id, agent_id, rotated_to_id)");
  });

  it("sets tenant context transaction-locally and includes explicit tenant/owner predicates", async () => {
    const source = await readFile(storeUrl, "utf8");
    expect(source).toContain("set_config('app.tenant_id', $1, true)");
    expect(source).toContain("where k.tenant_id = $1 and k.developer_id = $2 and k.id = $3");
    expect(source).toContain("where c.tenant_id = $1 and c.developer_id = $2 and c.agent_id = $3 and c.id = $4");
    expect(source).toContain("where tenant_id = $1 and developer_id = $2 and agent_id = $3 and id = $4");
  });
});
