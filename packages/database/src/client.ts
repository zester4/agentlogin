import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";

export type Database = NodePgDatabase<typeof schema>;

export interface DatabaseHandle {
  db: Database;
  pool: Pool;
  close: () => Promise<void>;
}

/**
 * pg-connection-string currently treats these deprecated aliases as
 * verify-full, but warns that their meaning will change in a future major.
 * Make today's strict certificate and hostname verification explicit.
 */
export function normalizePostgresSslMode(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    const sslMode = url.searchParams.get("sslmode")?.toLowerCase();

    if (sslMode && ["prefer", "require", "verify-ca"].includes(sslMode)) {
      url.searchParams.set("sslmode", "verify-full");
    }

    return url.toString();
  } catch {
    // Preserve non-URL connection strings and let node-postgres validate them.
    return connectionString;
  }
}

export function createDatabase(
  connectionString = process.env.DATABASE_URL,
): DatabaseHandle {
  if (!connectionString) {
    throw new Error("DATABASE_URL is required to connect to AgentLogin Postgres.");
  }

  const pool = new Pool({
    connectionString: normalizePostgresSslMode(connectionString),
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    allowExitOnIdle: false,
    application_name: "agentlogin-api",
  });

  return {
    db: drizzle(pool, { schema }),
    pool,
    close: () => pool.end(),
  };
}
