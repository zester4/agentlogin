import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

try {
  process.loadEnvFile(fileURLToPath(new URL("../../../../.env", import.meta.url)));
} catch (error) {
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  if (code !== "ENOENT") throw error;
}

const databaseUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required to run migrations");

const sql = postgres(databaseUrl, { max: 1, prepare: false });
const migrations = [
  { version: "0001_initial", url: new URL("../../../../db/migrations/0001_initial.sql", import.meta.url) },
  { version: "0002_identity_auth", url: new URL("../../../../db/migrations/0002_identity_auth.sql", import.meta.url) }
];

try {
  await sql.unsafe("create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now())");
  const runtimeRole = process.env.AGENTLOGIN_DB_RUNTIME_ROLE;
  if (!runtimeRole || !/^[a-z_][a-z0-9_]*$/.test(runtimeRole)) {
    throw new Error("AGENTLOGIN_DB_RUNTIME_ROLE must name the non-superuser API database role");
  }
  const runtimeRoles = await sql.unsafe("select rolsuper, rolbypassrls from pg_roles where rolname = $1", [runtimeRole]);
  const runtime = runtimeRoles[0] as { rolsuper?: boolean; rolbypassrls?: boolean } | undefined;
  const currentUsers = await sql.unsafe("select current_user as name");
  const migrationRole = (currentUsers[0] as { name?: string } | undefined)?.name;
  if (!runtime || runtime.rolsuper || runtime.rolbypassrls || migrationRole === runtimeRole) {
    throw new Error("Migration and runtime roles must be distinct; runtime role must be NOSUPERUSER NOBYPASSRLS");
  }
  await sql.unsafe('revoke insert, update, delete, truncate on schema_migrations from "' + runtimeRole + '"');
  await sql.unsafe('grant select on schema_migrations to "' + runtimeRole + '"');
  for (const migration of migrations) {
    const source = await readFile(migration.url, "utf8");
    const applied = await sql.begin(async (tx) => {
      const existing = await tx.unsafe("select version from schema_migrations where version = $1 limit 1", [migration.version]);
      if (existing.length > 0) return false;
      await tx.unsafe(source);
      await tx.unsafe("insert into schema_migrations (version) values ($1)", [migration.version]);
      return true;
    });
    process.stdout.write((applied ? "Applied " : "Skipped ") + migration.version + "\n");
  }
} finally {
  await sql.end({ timeout: 5 });
}
