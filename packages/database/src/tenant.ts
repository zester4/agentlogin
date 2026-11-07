import { sql } from "drizzle-orm";
import type { Database } from "./client.js";
import type { TenantTransaction } from "./types.js";

/**
 * All tenant-owned reads/writes must use this helper. tenantId must originate
 * from verified server-side identity, never caller-controlled request data.
 */
export async function withTenantTransaction<T>(
  database: Database,
  tenantId: string,
  operation: (tx: TenantTransaction) => Promise<T>,
): Promise<T> {
  if (!tenantId || tenantId.trim() !== tenantId || tenantId.length > 200) {
    throw new Error("A valid authenticated tenant context is required.");
  }

  return database.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.tenant_id', ${tenantId}, true)`,
    );
    return operation(tx);
  });
}
