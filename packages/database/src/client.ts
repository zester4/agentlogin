import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";
import { normalizePostgresSslMode } from "./postgres-ssl.js";

export { normalizePostgresSslMode } from "./postgres-ssl.js";

export type Database = NodePgDatabase<typeof schema>;

export interface DatabaseHandle {
  db: Database;
  pool: Pool;
  close: () => Promise<void>;
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
