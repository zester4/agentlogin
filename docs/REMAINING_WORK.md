# AgentLogin — Remaining Work

**Last reviewed:** 8 November 2026 (after live AWS KMS verification)  
**Repository:** [zester4/agentlogin](https://github.com/zester4/agentlogin)  
**Purpose:** Current checklist for the remaining setup, integration, and production-readiness work.

> Status labels distinguish code already present from production configuration and end-to-end verification. A merged PR or healthy deployment is not, by itself, proof that a security feature is production-ready.

## Current deployment

- Web: https://agentlogin-web-production.up.railway.app
- API health: https://agentlogin-production-90b2.up.railway.app/health
- Database: Neon PostgreSQL
- Web framework: Next.js 16.4.5 / React 19.3.1
- API: Fastify

The API health endpoint has returned HTTP 200. The web, API, and separate MCP Railway services have deployed successfully. Live authenticated MCP smoke testing and Auth0 organization-claim verification remain open.

## Completed foundations

- [x] Neon Postgres project and separate runtime/migration database roles.
- [x] Drizzle baseline migration generated and applied.
- [x] Tenant-scoped PostgreSQL repositories and transaction-local tenant context.
- [x] Row-level security enabled and FORCE RLS verified on the current tenant-owned tables.
- [x] Persistent agent credential repository, signed HMAC agent tokens, and Fastify agent authentication.
- [x] Auth0/OIDC user-token verification code, trusted tenant-claim validation, membership lookup, and onboarding API.
- [x] AES-256-GCM envelope encryption and callback-scoped decryption.
- [x] Durable encrypted credential-envelope storage.
- [x] AWS KMS Encrypt/Decrypt provider implemented.
- [x] Connected-account enrollment, credential rotation, and disconnect API routes call the encrypted vault/KMS provider.
- [x] Grant, delegation, approval, revocation, and secret-free audit persistence/API foundations.
- [x] Dashboard sections, connected-account metadata view, and approval inbox UI.
- [x] Railway web and API deployments.
- [x] PR #29 implementation-status/plan refresh merged (documentation only).
- [x] Set `AGENTLOGIN_API_URL=https://agentlogin-production-90b2.up.railway.app` on the Railway production web service.
- [x] Set `AUTH0_AUDIENCE=https://api.agentlogin.app` and `AUTH0_ORGANIZATION=org_fBUW065W2Ut6KHbt` on the web service.
- [x] Set `OIDC_ISSUER_URL`, `OIDC_AUDIENCE`, `OIDC_JWKS_URL`, `OIDC_TENANT_CLAIM`, and `OIDC_MAX_TOKEN_AGE=24h` on the API service.
- [x] Set `AWS_REGION=us-east-1`, the dedicated `AWS_KMS_KEY_ID` ARN, and the dedicated IAM service user's access keys on the Railway API service only.
- [x] GitHub CI passed for PR #31 and PR #32: lint, typecheck, build, and tests.
- [x] Confirmed the production API deployment after AWS KMS configuration completed successfully.
- [x] Ran the protected live KMS diagnostic: `kms_encrypt=true`, `kms_decrypt=true`, and `encryption_context_rejection=true`.
- [x] Removed the temporary `KMS_DIAGNOSTIC_TOKEN`; unauthenticated POST to `/internal/kms/self-test` now returns HTTP 404.
- [x] Added an opt-in PostgreSQL + AWS KMS lifecycle integration test; ordinary CI skips it unless explicitly enabled.
- [ ] Deploy and run the temporary protected `/internal/vault/lifecycle-self-test` endpoint against the production Neon runtime using only a dedicated synthetic tenant/user; remove its temporary token immediately afterward.

## Recently completed — PR #31 merged

PR: [#31 — Refresh AgentLogin docs and complete first-use dashboard onboarding](https://github.com/zester4/agentlogin/pull/31)

- [x] Refresh root README to describe the current repository accurately and remove the duplicate legacy-migrations entry.
- [x] Add this remaining-work tracker to `docs/REMAINING_WORK.md`.
- [x] Fix the dashboard's first-use flow: the overview provisions the signed-in user on first visit, and Connected Accounts/Approvals retry the idempotent `POST /v1/onboarding` endpoint server-side before loading their data.
- [x] Make OIDC maximum token age configurable with `OIDC_MAX_TOKEN_AGE` (default `24h`).
- [x] Update Auth0 setup documentation to explain automatic onboarding and current Auth0 tenant settings.

## SDK and MCP implementation — current branch

- [x] Replace the placeholder SDK with a typed HTTP client for the existing agent identity and grant-request API routes.
- [x] Correct the grant-request URL mismatch: the SDK calls `POST /v1/users/:userId/grants`.
- [x] Add token-provider support, bounded timeouts, safe GET retries, typed API errors, and request/response schema validation.
- [x] Replace the MCP tool-name placeholder with a real MCP TypeScript SDK v2.4.0 Streamable HTTP server.
- [x] Verify opaque agent credentials through the existing API authentication endpoint on every MCP request; do not duplicate token verification logic.
- [x] Expose only agent identity and user-approved access-request tools. Keep login execution and credential access unavailable until their backend is complete.
- [x] Add SDK and MCP client tests and developer integration documentation.
- [x] GitHub Actions passed on the current implementation: build, lint, typecheck, and tests (including the SDK and MCP client integration tests).
- [ ] Publish the public SDK and contracts packages to npm after package ownership, release metadata, and CI are verified.
- [x] Deploy a separate MCP Railway service and configure its hostname/origin allowlists.
- [ ] Run authenticated remote MCP smoke tests with a dedicated synthetic agent credential.
- [ ] Implement standard OAuth 2.1 discovery/authorization for remote MCP clients if automatic OAuth onboarding is required; current MCP HTTP auth accepts AgentLogin opaque agent tokens supplied by the host.

## Current follow-up work

The dashboard onboarding change uses the Auth0 access token only on the Next.js server. The API derives tenant and user identity from the signed token; the browser does not supply tenant/user IDs. The onboarding repository uses a transaction lock and reuses an existing active membership.

## 1. AWS KMS — live synthetic test passed; durable vault lifecycle verification next

### Completed and verified
- [x] Created the symmetric AWS KMS key and alias `alias/agentlogin-vault` in `us-east-1`.
- [x] Created the least-privilege IAM policy `AgentLoginVaultKmsUseOnly` for Encrypt/Decrypt on this key, constrained by allowed purpose values.
- [x] Created dedicated IAM user `agentlogin-vault-service` without console access and attached only that policy.
- [x] Created its programmatic access key; both values are stored only in Railway API service variables.
- [x] Configured `AWS_REGION`, `AWS_KMS_KEY_ID`, `AWS_ACCESS_KEY_ID`, and `AWS_SECRET_ACCESS_KEY` on the Railway API service only.
- [x] Production API deployment completed successfully after configuration.
- [x] Live synthetic KMS test passed Encrypt, Decrypt, and rejection when tenant encryption context was altered.
- [x] Removed the temporary `KMS_DIAGNOSTIC_TOKEN`; the diagnostic endpoint returned HTTP 404 after redeployment.

### Still to do
- [ ] Run the live PostgreSQL + KMS lifecycle check against Neon with a dedicated synthetic test user and tenant, using the least-privileged runtime database role. The protected temporary API route exercises the same repository/vault path from the production API environment, without copying Railway secrets out of Railway.
- [ ] Verify wrong/unrelated KMS key denial and KMS outage/failure behavior.
- [ ] Review CloudTrail for the expected principal and KMS operations; confirm no plaintext credential or DEK appears in logs.
- [ ] Document and test IAM access-key rotation, KMS key recovery, backup/restore, and incident response.

The live diagnostic proves KMS cryptographic access only. It does not prove that a credential was persisted in PostgreSQL or that the connected-account API lifecycle is production-ready.

## 2. Auth0 and user identity

### Completed in code / Auth0 console
- [x] Auth0 API created: `AgentLogin API`.
- [x] API audience: `https://api.agentlogin.app`.
- [x] RS256 selected in Auth0.
- [x] Auth0 Organization created: `AgentLogin Workspace`.
- [x] Organization ID: `org_fBUW065W2Ut6KHbt`.
- [x] User added as an Organization member.
- [x] API verifies issuer, audience, signature, HTTPS JWKS, token expiry/age, and namespaced tenant claim.
- [x] Auth0 Post-Login Action code and Login-flow attachment documented.
- [ ] Deploy the Post-Login Action and attach it to the Login flow in the Auth0 dashboard.
- [x] Dashboard server-side Auth0 audience/Organization request code exists.

### Still to do
- [ ] On PC, create/deploy the Post-Login Action that emits `https://agentlogin.app/tenant_id` from `event.organization.id`.
- [ ] Attach the Action to the Auth0 Login flow and apply it.
- [ ] Verify the Auth0 web application callback, logout, and web-origin URLs.
- [x] Set the API OIDC variables on Railway, including `OIDC_MAX_TOKEN_AGE=24h`.
- [x] Set the web audience, Organization ID, and API base URL on Railway.
- [x] Confirmed the web/API deployments triggered by the Railway environment changes succeeded.
- [ ] Verify existing Auth0 session/client variables are present and correctly configured.
- [ ] Sign out and sign in again; verify `GET /v1/user/me` returns the expected tenant and user.
- [ ] Verify token renewal/age behavior against the Auth0 API access-token lifetime and Next.js SDK renewal behavior. The API maximum token age is now configurable with `OIDC_MAX_TOKEN_AGE` (default `24h`); align it with the actual Auth0 token lifetime.
- [ ] Test missing organization, missing tenant claim, wrong issuer/audience, expired token, inactive membership, and cross-tenant access.

## 3. Dashboard and API integration

- [x] API returns connected-account metadata only; it does not return credential ciphertext or plaintext.
- [x] Pending approval API returns grant/approval metadata scoped to the authenticated user and tenant.
- [x] Approval decisions are sent from a Next.js server action; the bearer token is not exposed to browser JavaScript.
- [x] Dashboard onboarding integration is implemented on the current branch; merge and verify it.
- [ ] Verify connected-account listing with a real authenticated test account.
- [ ] Verify pending approval listing and approve/deny actions end to end.
- [ ] Verify that another user or tenant cannot view or decide the approval.
- [ ] Verify expired, already-decided, revoked, and wrong-owner approval behavior.
- [ ] Add visible feedback for approve/deny success and failure query parameters if not already implemented.
- [ ] Recheck mobile and light/dark dashboard layouts after deployment.

## 4. SDK, MCP, and browser execution

- [x] Typed SDK methods for agent identity, grant creation, and agent-owned grant-status retrieval.
- [x] Authenticated Streamable HTTP MCP server with identity, access-request, and grant-status tools.
- [x] Host and Origin validation, API-backed agent-token verification, and client integration tests.
- [x] SDK/MCP CI passed. See [SDK and MCP guide](./SDK_MCP.md).
- [ ] Verify the deployed MCP service and live calls with a dedicated test agent credential.
- [ ] Publish `@agentlogin/sdk` and `@agentlogin/contracts` after confirming npm scope ownership and release metadata.
- [ ] Implement MCP OAuth 2.1 discovery/authorization if general remote-client auto-onboarding is required.
- [ ] Implement an isolated browser worker and task-level login execution tools; do not expose secret retrieval.
- [ ] Implement an isolated browser worker behind the existing provider-neutral interface.
- [ ] Enforce exact origin and redirect validation before credential injection.
- [ ] Add SSRF/private-network/metadata endpoint protections.
- [ ] Keep cookies, browser storage, CDP, DevTools, and raw secret-bearing traces inaccessible to agents.
- [ ] Implement secure MFA/CAPTCHA user handoff and resume; never bypass these challenges.
- [ ] Add session cleanup and revocation handling.

## 5. Security and production-readiness gates

- [ ] Complete cross-tenant integration tests against Neon using the actual non-owner runtime role.
- [ ] Test agent token expiry, rotation, revocation, replay, and concurrent use.
- [ ] Test grant binding to tenant, user, authenticated agent, connected account, exact origin, scopes, expiry, policy version, approval, and task context.
- [ ] Test race-safe approval decisions and grant revocation.
- [ ] Test no secret leakage through API responses, dashboard HTML, logs, traces, errors, screenshots, DOM/accessibility output, artifacts, or worker IPC.
- [ ] Define KMS key rotation, access-key rotation, backup/restore, deletion, incident response, and monitoring procedures.
- [ ] Complete adversarial and independent security review; resolve all critical/high findings.
- [ ] Keep real customer credential enrollment disabled until every production credential gate is verified.

## Safety rules

1. Never put AWS credentials in GitHub, source files, frontend variables, or chat.
2. Keep AWS credentials on the Railway API service only.
3. Never return passwords, API keys, OAuth refresh tokens, cookies, or session secrets to agents.
4. A grant is scoped authorization, not a credential or blanket permission.
5. Login permission does not authorize arbitrary post-login actions.
6. Never claim production readiness based only on a merged PR, a KMS key existing, or a healthy health endpoint.

## Resume point

AWS KMS and the dedicated IAM service identity are configured, and the live synthetic KMS self-test passed. Next, deploy the protected synthetic vault lifecycle diagnostic, create the dedicated synthetic Neon tenant/user, run the full persistence/rotation/revocation/disconnect check, then remove all temporary diagnostic variables and confirm the endpoint returns 404. Never use real website credentials for this test.
