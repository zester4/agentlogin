# Implementation status

Last reviewed: 2026-11-08 (after vault lifecycle test, PR #49 merge, production migration, and four-service Railway deployment). This is a snapshot of the repository and deployment state on `main`. “Implemented” means code exists; it does not automatically mean a feature is fully configured, deployed, or production-ready.

## Current implementation

| Area | Implemented now | Still open / important boundary |
|---|---|---|
| Vault cryptography | AES-256-GCM envelope encryption with fresh 256-bit DEKs, authenticated context binding, callback-scoped decryption, and temporary-buffer clearing. AWS KMS wrap/unwrap adapter is wired into connected-account enrollment and credential rotation. The production Railway API completed a synthetic live KMS self-test: Encrypt, Decrypt, and altered-tenant encryption-context rejection all passed. The temporary diagnostic token was removed; the endpoint now returns 404. | The production synthetic Neon + KMS vault lifecycle test passed all 8 checks. Synthetic records and temporary diagnostic variables were removed; the diagnostic endpoint now returns 404. Still verify unrelated-key denial, KMS outage/failure behavior, CloudTrail identity/actions, and recovery/rotation procedures. |
| Durable credential storage | PostgreSQL credential-envelope repository persists ciphertext, IV, authentication tag, wrapped DEK, key version, and lifecycle metadata. Credential enrollment, rotation, and disconnect routes exist in the API. An opt-in PostgreSQL + AWS KMS lifecycle integration test has been added; it checks ciphertext-only persistence, callback-only decryption/buffer clearing, rotation, revocation, and tenant-bound lookup. | The live synthetic Neon + KMS lifecycle test passed all 8 checks; synthetic records and temporary diagnostic variables were removed and the diagnostic endpoint returns 404. The complete user-facing enrollment and secure handoff flow, production recovery/deletion procedures, unrelated-key denial, KMS outage testing, CloudTrail review, and operational rotation remain open. |
| Plaintext handling | Decryption is callback-scoped; plaintext buffers are cleared after callback completion. Agent-facing paths are designed to return safe metadata/results, not secrets. | JavaScript cannot guarantee erasure of every copy or garbage-collected memory. Callers must never copy, retain, serialize, log, or return plaintext. Verify all worker, error, telemetry, and artifact paths. |
| Agent authentication | Persistent PostgreSQL agent-credential repository; opaque credentials stored as hashes; signed HMAC token format; Fastify authentication middleware; expiry, revocation, tenant, developer, and agent-state checks. | Complete adversarial and concurrency review, key-ring/rotation operations, abuse controls, and end-to-end production verification. |
| User/developer identity | Auth0/OIDC verification path, trusted tenant-claim handling, membership model, onboarding and agent-management API routes are implemented in code. | Finish Auth0 tenant-claim Action and Login flow configuration, verify real access tokens and organization membership, and test owner/member authorization against the deployed API. Dashboard-to-API behavior must be verified with a fully configured identity. |
| Tenant isolation | Tenant-scoped repositories use transaction-local tenant context. RLS is enabled and FORCE RLS has been verified on all 12 current tenant-owned tables; runtime and migration roles are separate and least-privileged. | Keep schema, RLS policy verification, and role checks in CI. Run the complete cross-tenant and membership integration suite against Neon using the actual runtime role, including negative cases. |
| Grants and approvals | Persistent grant and approval repositories, policy checks, request/approve/deny/revoke routes, expiry and revocation checks, and secret-free audit writes exist. Dashboard approval inbox integration is implemented. | Verify the complete user-to-agent lifecycle against the deployed Auth0/API configuration; test race-safe revocation, replay, concurrency, and approval enforcement. |
| Database and deployment | Neon PostgreSQL is connected; Drizzle migrations are applied. Railway API, web, MCP, and webhook worker services are all online in production; the API pre-deploy migration completed successfully and `/health` returned HTTP 200. The webhook queue has RLS and FORCE RLS enabled. | Continue checking production migrations and schema/RLS state after releases. Review the non-fatal PostgreSQL SSL-mode warning in deploy logs and keep monitoring recent deployment failures. |
| Dashboard | Branded Next.js 16 dashboard with account, agent, grant, approval, activity, and security sections; responsive mobile layout and light/dark themes. Connected-account and approval API integration is in place. | Several product workflows still show coming-soon states because the complete enrollment, agent execution, and activity stream are not yet available. Verify Auth0 configuration and API data paths in production. |
| SDK and MCP | Typed TypeScript SDK supports agent identity, grant requests, and grant-status lookup. MCP uses the Streamable HTTP transport with agent-token verification and identity/access-request/status tools. The separate Railway MCP service is deployed. | Publish the SDK/contracts packages to npm, complete authenticated remote smoke tests, and consider OAuth 2.1 discovery/authorization if automatic remote-client onboarding is required. Login execution tools remain intentionally unavailable until the isolated browser worker is ready. |
| Browser execution | Provider-neutral execution interfaces/coordinator and grant-bound authorization checks exist. | A concrete isolated browser worker/provider, credential broker inside the worker, origin/redirect/SSRF protections, and secure MFA/CAPTCHA user handoff/resume UI remain open. |
| Webhooks and synchronization | Durable endpoint/event/delivery/attempt schema, transactional enqueue primitive, queue migration, lease-based worker, retry/completion functions, HMAC signing, KMS secret-context handling, and SSRF-safe outbound request layer are implemented. Worker is deployed but explicitly disabled. PRs #41, #42, #44, #47, #48, and #49 are merged. | Finish endpoint CRUD/test/history/replay API and SDK, integrate event enqueueing into all intended domain transactions, implement dashboard SSE/reconnect/polling fallback, complete adversarial and end-to-end delivery tests, then enable only after explicit release verification. Webhooks are not yet supported product functionality. |
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
10. Railway API, web, MCP, and webhook worker deployments; all four production services currently online.
11. Durable webhook schema and queue/worker security foundation merged and deployed; worker remains disabled.

These are implementation milestones, not a declaration that every associated production configuration or end-to-end workflow is complete.

## Remaining work — current priorities

1. Finish Auth0 Organization tenant-claim Action/flow configuration and verify real user-to-API authorization end to end.
2. Complete secure user-facing credential enrollment and account connection/update/disconnect; keep real credentials blocked.
3. Build the isolated browser worker, credential broker, origin/redirect/SSRF protections, output sanitization, cleanup, and MFA/CAPTCHA handoff/resume.
4. Finish SDK/contracts npm publication checks and authenticated remote MCP smoke tests; login execution tools remain blocked on browser execution.
5. Complete webhook endpoint CRUD/test/history/replay APIs and SDK helpers; wire events into domain transactions; implement dashboard SSE with reconnect/cursor/polling fallback.
6. Run webhook end-to-end tests (atomicity, tenant isolation, HMAC/timestamp, SSRF/DNS rebinding, retries, leases, replay, secret redaction) before enabling the worker.
7. Run full cross-tenant, agent/grant replay/expiry/revocation/concurrency, and secret-leak tests against Neon/runtime role; review CloudTrail, unrelated-key denial, and KMS outage behavior.
8. Complete independent security review and operational key rotation/recovery, backup/restore, deletion, monitoring, and incident-response gates.

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
