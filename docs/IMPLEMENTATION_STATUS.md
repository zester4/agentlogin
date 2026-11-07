# Implementation status

Last reviewed: 2026-11-07. This document records code that exists on the implementation branch; it does not declare a production release.

## Implemented foundations in this change

| Area | Implemented | Boundary / remaining work |
|---|---|---|
| Vault cryptography | AES-256-GCM envelope encryption; fresh 256-bit DEK and 96-bit IV; 128-bit tag; AAD binds tenant, credential, version and purpose; DEK wrapped via interface | No production KMS adapter, durable repository, decrypt-only worker identity, rotation, backup/restore or independent review |
| Plaintext handling | Callback-scoped decryption and temporary-buffer zeroing after callback completion | JavaScript cannot guarantee erasure of all copies/GC memory; callers must not copy, retain, serialize, log or return plaintext |
| Agent authentication | High-entropy opaque token issuance; SHA-256 hash storage; timing-safe hash comparison; tenant/developer/agent state checked from repository row | Repository interface only; no production database adapter, HTTP middleware, user/developer login, rate limits or token-management UX |
| Tenant isolation | Composite tenant foreign keys; Drizzle schema policies; transaction-local RLS context; migration-time FORCE ROW LEVEL SECURITY enforcement | Still needs actual PostgreSQL integration tests using the production non-owner runtime role; API middleware is not yet wired |
| Grant policy | Tenant/user/agent/account/scope/expiry/revocation/approval checks; policy version match; canonical origin validation | Grant persistence, approval service, transaction-safe revocation and API route integration remain outstanding |
| Database | Neon-compatible Node pg pool; Drizzled typed schema and queries; generated SQL migration workflow; direct URL required for migrations | No Neon project provisioned, no production DB roles/secrets, no persistent repositories wired into API |\n| Cloudflare | D1 is not the primary database; Cloudflare remains optional edge/security infrastructure | No Cloudflare Worker, Wrangler project, account binding or deployment is selected or configured |
| Tests | Unit tests for vault tampering/context binding/revocation; agent token hash/authentication/revocation; grant denial cases | Add database/RLS integration tests, API auth integration, fuzz/property tests, concurrency/replay and independent penetration testing |
| Project hygiene | CI typecheck failure corrected in API error handler; CI includes lint, typecheck, tests and build; contribution guide and Apache-2.0 license | Confirm new workflow results after this branch is pushed |

## Immediate next milestones

1. Provision/select a Neon project and configure least-privilege runtime and migration roles.
2. Generate and review the first Drizzle baseline migration; verify RLS policies and FORCE RLS against real Postgres.
3. Implement PostgreSQL repositories and transaction-scoped tenant context; test RLS with the actual non-owner runtime role.
4. Wire opaque agent authentication into Fastify request context and protect agent routes.
5. Implement developer/user authentication and secure credential enrollment.
6. Select and implement a production KMS adapter; define key policies, rotation, rewrapping and incident response.
7. Implement durable credential storage and audited decrypt authorization.
8. Persist grants, delegations, policy versions and approvals; make revocation race-safe.
9. Implement isolated browser execution with origin/redirect/SSRF controls and user handoff for MFA/CAPTCHA.
10. Implement SDK/MCP transport only after authenticated identity and output sanitization are enforced.
11. Add database, integration, adversarial, concurrency and security review gates.

## Production credential gate

Do not accept real credentials until production identity, database isolation, KMS, encrypted storage, audited decrypt authorization, grant/approval lifecycle, isolated execution, secret-safe telemetry, deletion/rotation procedures and independent security review are complete. Passing unit tests does not satisfy this gate.
