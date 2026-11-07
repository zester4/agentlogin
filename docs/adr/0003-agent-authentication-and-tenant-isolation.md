# ADR 0003: Opaque agent credentials and database tenant isolation

- Status: Accepted for the first identity foundation
- Date: 2026-11-07

## Decision

Agent credentials are high-entropy opaque tokens. The raw token is returned once at issuance; only its SHA-256 hash is persisted. Authentication resolves the credential record and derives tenant, developer and agent identity from the trusted database row, never from caller-supplied claims.

The identity package rejects expired and revoked credentials and credentials belonging to suspended or closed tenants, developers or agents. Rotation is performed by issuing a replacement and revoking the old record.

PostgreSQL row-level security is enabled for tenant-owned tables. Runtime transactions must set app.tenant_id transaction-locally from verified identity context and use a non-owner database role without BYPASSRLS.

## Boundary

This is an identity primitive and repository contract, not a complete production login system. A production database repository, authenticated API middleware, developer/user login, rate limiting, token rotation UX and integration tests remain outstanding. RLS is defense in depth, not a substitute for application authorization.

## References

- https://www.postgresql.org/docs/current/ddl-rowsecurity.html
- https://nodejs.org/api/crypto.html
