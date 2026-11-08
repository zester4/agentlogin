# AgentLogin — Remaining Work

**Last reviewed:** 8 November 2026  
**Repository:** [zester4/agentlogin](https://github.com/zester4/agentlogin)  
**Purpose:** Current checklist for the remaining setup, integration, and production-readiness work.

> Status labels distinguish code already present from production configuration and end-to-end verification. A merged PR or healthy deployment is not, by itself, proof that a security feature is production-ready.

## Current deployment

- Web: https://agentlogin-web-production.up.railway.app
- API health: https://agentlogin-production-90b2.up.railway.app/health
- Database: Neon PostgreSQL
- Web framework: Next.js 16.4.5 / React 19.3.1
- API: Fastify

The API health endpoint has previously returned HTTP 200. Recheck deployments after the current integration PR is merged.

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
- [x] Set `AWS_REGION=us-east-1` and the dedicated `AWS_KMS_KEY_ID` ARN on the API service. AWS IAM access keys are not yet created or configured.
- [x] GitHub CI passed for PR #31: lint, typecheck, build, and tests.
- [ ] Confirm the web/API redeployments triggered by the environment changes finish successfully.

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
- [ ] Run the new branch's GitHub CI and resolve all build/type/test failures.
- [ ] Publish the public SDK and contracts packages to npm after package ownership, release metadata, and CI are verified.
- [ ] Deploy a separate MCP Railway service and configure its hostname/origin allowlists before sharing the endpoint.
- [ ] Implement standard OAuth 2.1 discovery/authorization for remote MCP clients if automatic OAuth onboarding is required; current MCP HTTP auth accepts AgentLogin opaque agent tokens supplied by the host.

## Current follow-up work

The dashboard onboarding change uses the Auth0 access token only on the Next.js server. The API derives tenant and user identity from the signed token; the browser does not supply tenant/user IDs. The onboarding repository uses a transaction lock and reuses an existing active membership.

## 1. AWS KMS — waiting for PC access

### Completed
- [x] Created the AWS KMS key.
- [x] Alias: `alias/agentlogin-vault`
- [x] Region: `us-east-1`
- [x] Key ID: `ce73891f-9bca-41ea-b9dc-e4555703b4fd`
- [x] Key ARN: `arn:aws:kms:us-east-1:471742380391:key/ce73891f-9bca-41ea-b9dc-e4555703b4fd`
- [x] Key is symmetric, enabled, and supports Encrypt/Decrypt.
- [x] Least-privilege IAM policy JSON prepared in the conversation.

### Still to do
- [ ] Create IAM policy `AgentLoginVaultKmsUseOnly` using the prepared policy JSON.
- [ ] Create a dedicated IAM user for the AgentLogin API; do not enable console sign-in.
- [ ] Attach only `AgentLoginVaultKmsUseOnly`.
- [ ] Create a programmatic access key.
- [ ] Store the access key ID and secret only in Railway **API service** variables. Never paste them into chat or commit them.
- [ ] Set `AWS_REGION=us-east-1` on the API service.
- [ ] Set `AWS_KMS_KEY_ID` to the full key ARN above on the API service.
- [ ] Set `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` on the API service only.
- [ ] Verify the API's AWS SDK credential chain can use the key.
- [ ] Test live credential enrollment and rotation through KMS.
- [ ] Test wrong encryption-context denial, wrong-key denial, and KMS outage/failure behavior.
- [ ] Check CloudTrail and confirm no plaintext credentials or DEKs are logged or persisted.

**Important:** KMS provider construction is already present in the connected-account enrollment and credential-rotation handlers. The remaining work is AWS identity/configuration on Railway and end-to-end verification. Do not claim production vault encryption is ready until the live checks pass.

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
- [ ] Confirm the variable-triggered web/API deployments succeed.
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

- [ ] Complete authenticated SDK methods and typed safe result contracts.
- [ ] Implement authenticated MCP transport and task-level tools; do not expose secret retrieval.
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

## Resume point when PC access returns

Resume at **AWS IAM policy creation**. The policy JSON is prepared, but the IAM policy has not yet been confirmed as created. Then create the restricted IAM user, configure the API service's AWS variables, and run live KMS verification.
