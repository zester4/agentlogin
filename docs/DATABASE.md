# Neon Postgres and Drizzle

AgentLogin uses Neon Postgres + Drizzle ORM as its primary persistence layer.

## Connection strings

- DATABASE_URL: pooled Neon URL for the API's normal query traffic.
- DATABASE_URL_UNPOOLED: direct, non-pooled Neon URL for migrations and administrative DDL.

Never commit either value. Production must use separate least-privilege roles: the API runtime role must not own tables and must not have BYPASSRLS; the migration role needs the DDL privileges required to apply reviewed migrations.

## Schema and migrations

The canonical schema is packages/database/src/schema.ts. All schema changes begin there.

```bash
pnpm db:generate
pnpm db:migrate
```

db:generate creates SQL migration files from schema.ts. Review and commit the SQL and Drizzle metadata under db/migrations with the schema change. db:migrate applies the committed migrations using DATABASE_URL_UNPOOLED and then enforces FORCE ROW LEVEL SECURITY.

Do not use drizzle-kit push in production. It bypasses the reviewed migration artifact and weakens change control.

## Tenant isolation

Every tenant-owned table has a Drizzle-defined PostgreSQL RLS policy using the transaction-local setting app.tenant_id. withTenantTransaction sets that value using set_config(..., true) inside the same transaction as the tenant's queries, so it cannot leak to the next pooled connection borrower.

The migration command also enforces FORCE ROW LEVEL SECURITY. Production API connections must use a non-owner role without BYPASSRLS; table owners and privileged roles can otherwise bypass RLS.

Tenant IDs must come from verified server-side authentication context. Never accept tenant context from an agent, request body, query parameter, or caller-controlled header. All tenant-owned reads and writes must run through withTenantTransaction.

## Runtime use

```ts
const { db, close } = createDatabase(process.env.DATABASE_URL);
const account = await withTenantTransaction(
  db,
  authenticatedIdentity.tenantId,
  (tx) => findConnectedAccount(tx, accountId),
);
await close();
```

Do not return ciphertext, wrapped DEKs, token hashes, or credential rows from public API routes. Credential decryption remains a separate, explicitly authorized vault operation.

## Current boundary

This package provides the typed schema, pooled Node Postgres client, transaction-scoped RLS context and safe metadata query helpers. It does not yet provision a Neon project, create production database roles, configure KMS, or wire API authentication middleware to the database.
