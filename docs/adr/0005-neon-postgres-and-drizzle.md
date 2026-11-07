# ADR 0005: Neon Postgres and Drizzle ORM

- Status: Accepted
- Date: 2026-11-07

## Context

AgentLogin is a security-sensitive, multi-tenant credential authorization platform. Persistence requires relational constraints, composite tenant foreign keys, transaction-scoped authorization context, PostgreSQL Row-Level Security, auditable migrations and reliable concurrency semantics.

Cloudflare D1 is SQLite-based and would require a separate database dialect and a weaker fit with the existing PostgreSQL schema and RLS design. D1 remains an optional edge-local store only if a measured requirement justifies it later.

## Decision

Use Neon Postgres as the primary relational database and Drizzle ORM as the TypeScript schema, query and migration layer. Use the Node pg driver for the current long-running Fastify API. The API uses Neon's pooled connection string; migrations use a direct, non-pooled connection string.

The canonical schema lives in packages/database/src/schema.ts. Typed queries live in packages/database/src/query.ts. Generated SQL migrations are reviewed and committed under db/migrations.

## Security requirements

- Tenant IDs come only from verified server-side identity.
- Every tenant-owned query runs inside withTenantTransaction, which binds app.tenant_id transaction-locally.
- Tenant-owned tables use PostgreSQL RLS and FORCE ROW LEVEL SECURITY.
- The API database role is not a table owner and does not have BYPASSRLS.
- The migration role is separate and has only the DDL privileges needed to apply reviewed migrations.
- Ordinary account metadata queries never select credential ciphertext and never return secret material to agents.

## Consequences

- PostgreSQL is the source of truth and migrations remain portable across Postgres hosts.
- D1-specific code is intentionally not introduced into the domain layer.
- Neon project region and roles must be selected/configured before production database integration.
- Database integration tests must run with the actual non-owner runtime role and prove cross-tenant denial.
