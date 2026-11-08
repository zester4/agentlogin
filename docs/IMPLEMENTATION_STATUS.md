# Implementation status

Last reviewed: 2026-11-08 (after live AWS KMS verification). This is a snapshot of the repository and deployment state on `main`. “Implemented” means code exists; it does not automatically mean a feature is fully configured, deployed, or production-ready.

## Current implementation

| Area | Implemented now | Still open / important boundary |
|---|---|---|
| Vault cryptography | AES-256-GCM envelope encryption with fresh 256-bit DEKs, authenticated context binding, callback-scoped decryption, and temporary-buffer clearing. AWS KMS wrap/unwrap adapter is wired into connected-account enrollment and credential rotation. The production Railway API completed a synthetic live KMS self-test: Encrypt, Decrypt, and altered-tenant encryption-context rejection all passed. The temporary diagnostic token was removed; the endpoint now returns 404. | Still verify unrelated-key denial, KMS outage/failure behavior, CloudTrail identity/actions, and the full PostgreSQL + KMS credential lifecycle using synthetic records. The diagnostic does not create or retrieve a database credential. |
| Durable credential storage | PostgreSQL credential-envelope repository persists ciphertext, IV, authentication tag, wrapped DEK, key version, and lifecycle metadata. Credential enrollment, rotation, and disconnect routes exist in the API. An opt-in PostgreSQL + AWS KMS lifecycle integration test has been added; it checks ciphertext-only persistence, callback-only decryption/buffer clearing, rotation, revocation, and tenant-bound lookup. | The new integration test has not yet been run against Neon. The complete user-facing enrollment and secure handoff flow, production recovery/deletion procedures, and operational rotation remain open. |
| Plaintext handling | Decryption is callback-scoped; plaintext buffers are cleared after callback completion. Agent-facing paths are designed to return safe metadata/results, not secrets. | JavaScript cannot guarantee erasure of every copy or garbage-collected memory. Callers must never copy, retain, serialize, log, or return plaintext. Verify all worker, error, telemetry, and artifact paths. |
| Agent authentication | Persistent PostgreSQL agent-credential repository; opaque credentials stored as hashes; signed HMAC token format; Fastify authentication middleware; expiry, revocation, tenant, developer, and agent-state checks. | Complete adversarial and concurrency review, key-ring/rotation operations, abuse controls, and end-to-end production verification. |
| User/developer identity | Auth0/OIDC verification path, trusted tenant-claim handling, membership model, onboarding and agent-management API routes are implemented in code. | Finish Auth0 tenant-claim Action and Login flow configuration, verify real access tokens and organization membership, and test owner/member authorization against the deployed API. Dashboard-to-API behavior must be verified with a fully configured identity. |
| Tenant isolation | Tenant-scoped repositories use transaction-local tenant context. RLS is enabled and FORCE RLS has been verified on all 12 current tenant-owned tables; runtime and migration roles are separate and least-privileged. | Keep schema, RLS policy verification, and role checks in CI. Run the complete cross-tenant and membership integration suite against Neon using the actual runtime role, including negative cases. |
| Grants and approvals | Persistent grant and approval repositories, policy checks, request/approve/deny/revoke routes, expiry and revocation checks, and secret-free audit writes exist. Dashboard approval inbox integration is implemented. | Verify the complete user-to-agent lifecycle against the deployed Auth0/API configuration; test race-safe revocation, replay, concurrency, and approval enforcement. |
| Database and deployment | Neon PostgreSQL is connected; Drizzle baseline migration has been generated and applied. Railway web and API services are deployed; API health endpoint responds successfully. Persistent repositories are used by API routes. | Verify every production migration and schema/RLS state after future releases. Resolve and monitor any deployment-specific database warnings rather than assuming health checks cover all database paths. |
| Dashboard | Branded Next.js 16 dashboard with account, agent, grant, approval, activity, and security sections; responsive mobile layout and light/dark themes. Connected-account and approval API integration is in place. | Several product workflows still show coming-soon states because the complete enrollment, agent execution, and activity stream are not yet available. Verify Auth0 configuration and API data paths in production. |
| SDK and MCP | Typed TypeScript SDK supports agent identity, grant requests, and grant-status lookup. MCP uses the Streamable HTTP transport with agent-token verification and identity/access-request/status tools. The separate Railway MCP service is deployed. | Publish the SDK/contracts packages to npm, complete authenticated remote smoke tests, and consider OAuth 2.1 discovery/authorization if automatic remote-client onboarding is required. Login execution tools remain intentionally unavailable until the isolated browser worker is ready. |
| Browser execution | Provider-neutral execution interfaces/coordinator and grant-bound authorization checks exist. | A concrete isolated browser worker/provider, credential broker inside the worker, origin/redirect/SSRF protections, and secure MFA/CAPTCHA user handoff/resume UI remain open. |
| Webhooks and synchronization | No durable webhook delivery or dashboard live-event stream is implemented yet. The design is documented in docs/WEBHOOKS.md. | Implement transactional outbox, tenant-scoped endpoint management, signed HMAC delivery, SSRF protections, retries/dead-letter/replay, and dashboard SSE with polling fallback. Do not claim webhooks are available until verified. |
| Tests | Unit tests cover identity, agent tokens, vault context/tampering, grants, approvals, and authorization denials. An opt-in PostgreSQL RLS integration suite exists. | Run integration tests against the deployed database/runtime role; add adversarial, property/fuzz, replay, concurrency, browser-isolation, and secret-leak tests. Establish independent security review gates. |
| Cloudflare | Cloudflare is optional infrastructure, not the primary database or a required dependency. | No Cloudflare deployment is required for the current Railway/Neon architecture. Add it only for a defined product need. |

## Completed foundations

1. Neon project and separate least-privilege runtime/migration database roles.
2. Drizzle baseline migration generated, reviewed, and applied.
3. PostgreSQL repositories and transaction-scoped tenant context.
4. Agent authentication wired into Fastify.
5. User/developer OIDC authentication and membership/onboarding code paths.
6. AWS KMS wrap/unwrap adapter implemented and called by credential enrollment/rotation routes.
7. Durable encrypted credential-envelope storage and lifecycle API routes.
8. Grant, delegation, and approval persistence with API routes.
9. Dashboard sections and approval inbox integration.
10. Railway web and API deployments with health checks.

These are implementation milestones, not a declaration that every associated production configuration or end-to-end workflow is complete.

## Remaining work — current priorities

1. Finish Auth0 organization/tenant claim configuration and verify the real user-to-API flow.
2. Run the new opt-in PostgreSQL + AWS KMS lifecycle integration test against Neon using a dedicated synthetic test user/tenant and the least-privileged runtime role; then verify unrelated-key denial, KMS outage behavior, and CloudTrail records.
3. Complete secure credential enrollment and user-facing account connection/management.
4. Build the isolated browser worker, credential-broker integration, origin/redirect/SSRF controls, and MFA/CAPTCHA handoff/resume.
5. Finish npm release verification for the SDK/contracts packages and verify the live MCP Railway deployment plus authenticated remote smoke tests.
6. Implement the durable webhook outbox/delivery service and dashboard SSE/polling synchronization.
7. Run cross-tenant integration tests against Neon using the runtime role, plus adversarial, replay, concurrency, and secret-leak tests.
8. Complete independent security review, operational key rotation/recovery, backup/restore, deletion, monitoring, and incident-response gates.

## Production credential gate

Do not accept real website credentials until all of the following are verified in the production environment:

- Trusted user and agent identity, tenant membership, and owner/admin authorization.
- Tenant isolation and database access tested using the non-owner runtime role.
- AWS KMS live synthetic Encrypt/Decrypt and altered-tenant encryption-context rejection are verified. The PostgreSQL credential lifecycle must still pass with KMS; unrelated-key denial, key mismatch, outage behavior, and CloudTrail review remain required.
- Durable encrypted storage, enrollment, rotation, revocation, deletion, and recovery procedures verified.
- Grant and approval enforcement proven end to end, including race-safe revocation and denial of wrong-tenant, wrong-agent, wrong-account, wrong-origin, wrong-scope, expired, and revoked requests.
- Isolated browser execution with credential injection only inside the trusted worker, origin/redirect/SSRF protections, no agent access to cookies/storage/debugging interfaces, and secure MFA/CAPTCHA user handoff.
- Secret-free logs, traces, errors, screenshots, DOM/accessibility output, artifacts, and worker IPC.
- Adversarial and concurrency tests plus independent security review with no unresolved critical/high findings.

Passing unit tests, having a KMS key, or seeing a healthy Railway deployment does not by itself satisfy this gate.
