# Neon Postgres and Drizzle

AgentLogin uses standard PostgreSQL through Drizzle ORM. Neon is the hosted production provider; local PostgreSQL is supported by the same schema, driver and migration tooling.

## Connection strings

- `DATABASE_URL`: pooled URL for API traffic (Neon) or a normal PostgreSQL URL locally.
- `DATABASE_URL_UNPOOLED`: direct, non-pooled URL for migrations and administrative DDL. For local PostgreSQL, this can be the same local database URL.
- `TEST_DATABASE_URL`: optional connection to a disposable PostgreSQL test database, using a non-superuser, non-BYPASSRLS role. The RLS integration test is skipped when this is unset.

Never commit connection strings. Production must use separate least-privilege roles: the API runtime role must not own application tables and must not have BYPASSRLS; the migration role needs the DDL privileges required to apply reviewed migrations.

## Schema and migrations

The canonical schema is `packages/database/src/schema.ts`. All schema changes begin there.

```bash
pnpm db:generate
pnpm db:migrate
```

`db:generate` creates SQL migration files from `schema.ts`. Review and commit the SQL and Drizzle metadata under `db/migrations` with the schema change. `db:migrate` applies the committed migrations using `DATABASE_URL_UNPOOLED` and then enforces `FORCE ROW LEVEL SECURITY`.

Do not use `drizzle-kit push` in production. It bypasses the reviewed migration artifact and weakens change control.

**Deployment rule:** production deploys apply committed migrations; they must not generate migrations from the deployed source tree. Generation belongs in development/CI when a schema change is authored. Railway should run `pnpm db:migrate` as a pre-deploy command after the baseline migration has been generated, reviewed and committed. Keep the application build command as `pnpm build`. This avoids silently generating and applying unreviewed schema changes during a deploy.

## Tenant isolation

Every tenant-owned table has a Drizzle-defined PostgreSQL RLS policy using the transaction-local setting `app.tenant_id`. `withTenantTransaction` sets that value using `set_config(..., true)` inside the same transaction as the tenant's queries, so it cannot leak to the next pooled connection borrower.

The migration command also enforces `FORCE ROW LEVEL SECURITY`. Production API connections must use a non-owner role without `BYPASSRLS`; table owners and privileged roles can otherwise bypass RLS.

Tenant IDs must come from verified server-side authentication context. Never accept tenant context from an agent, request body, query parameter, or caller-controlled header. All tenant-owned reads and writes must run through `withTenantTransaction`.

## Testing

The unit tests mock the transaction boundary. The PostgreSQL integration test in `packages/database/src/rls.integration.test.ts` exercises actual database RLS behavior: tenant A/B row visibility, missing-tenant fail-closed behavior, cross-tenant insert rejection, and verification that the connected role is neither superuser nor `BYPASSRLS`.

Run it against a disposable PostgreSQL database with a dedicated non-owner role:

```bash
TEST_DATABASE_URL='postgresql://...' pnpm --filter @agentlogin/database test
```

Do not point destructive or disposable integration tests at a production database. The integration test creates a temporary table and rolls back its transaction.

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

The Neon project and a non-owner runtime role have been provisioned. The Drizzle schema, pooled Node Postgres client, transaction-scoped RLS context and metadata query helpers are in the repository. The baseline Drizzle migration still needs to be generated and reviewed before applying the schema to the live database. API authentication middleware, persistent repositories, production KMS integration and isolated browser execution remain separate implementation gates. Do not accept real credentials yet.
