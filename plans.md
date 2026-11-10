# AgentLogin — Product and Engineering Plan

> Living implementation plan. Update status only when work is implemented and verified in this repository.
>
> AgentLogin is independent. It is not part of Chusky and must not depend on Chusky or Chusky's browser. AgentLogin owns its browser-execution abstraction and selects its own provider.

## 1. Product definition

**AgentLogin gives agents controlled access to user accounts without exposing the user's credentials to the agent.**

A user connects an account once. An agent requests permission to use it for a specific purpose. AgentLogin evaluates the request, obtains approval when required, and returns an opaque, short-lived grant. AgentLogin performs authentication and authorized operations inside its protected execution boundary.

### Product promise

- Agents can log into websites and use connected services on behalf of users.
- Agents never receive passwords, API keys, OAuth tokens, cookies, recovery codes, or other authentication secrets.
- Developers integrate AgentLogin into their own agent systems through SDK, REST, or MCP.
- Users retain control through scoped permissions, approval, expiry, revocation, and audit history.

### Core response contract

Approved grant:

~~~json
{
  "status": "approved",
  "grant_id": "grt_...",
  "origin": "https://accounts.example.com",
  "expires_at": "2026-11-07T19:31:00Z",
  "scopes": ["autofill_login"]
}
~~~

Never return raw credentials:

~~~json
{
  "email": "user@example.com",
  "password": "..."
}
~~~

A grant authorizes only its declared scopes and context. It is not a password, unrestricted bearer token, browser session export, or blanket permission to use the account.

## 2. Product requirements

### 2.1 Agent-first experience

The primary workflow begins with an agent request, not a developer manually fetching secrets.

An agent must be able to:
1. identify itself to AgentLogin;
2. discover/reference accounts delegated to it;
3. request a narrowly scoped grant for a task and target origin;
4. receive approved, denied, or pending status;
5. execute the allowed operation using the grant;
6. receive sanitized results and actionable status codes;
7. continue or stop based on the result.

Developers configure and integrate AgentLogin, but the agent is the primary runtime consumer.

### 2.2 User experience

Users need to:
- create an account/workspace;
- securely connect a website account or service;
- understand what access is delegated and to which agent;
- set allowed scopes, approval requirements, and expiry;
- approve or deny sensitive requests;
- see active grants and recent activity;
- revoke a grant, agent, connected account, or session;
- update credentials and disconnect accounts.

Credential enrollment must use a trusted AgentLogin-controlled flow. Never ask users to paste credentials into an agent conversation or send them through an agent tool call.

### 2.3 Developer experience

Provide:
- TypeScript SDK first;
- REST API with OpenAPI documentation;
- MCP server/tool interface;
- agent identity and task-context model;
- typed grant and operation results;
- webhooks for approval-required, grant-revoked, execution-completed, and account-disconnected;
- local development fixtures with fake credentials only.

No agent-facing SDK/API method may return raw credentials. Do not create getPassword, getToken, getCookie, exportSession, or equivalent secret-extraction methods.

## 3. System architecture

Keep the implementation modular and provider-neutral.

~~~text
User / Developer
      |
      v
AgentLogin Dashboard + Secure Enrollment
      |
      v
Agent / SDK / REST / MCP
      |
      v
AgentLogin API + Security Gateway
  - developer / tenant authentication
  - agent identity and user delegation
  - policy engine and approvals
  - grant issuance and revocation
  - audit and rate limits
      |
      +----------------------+
      |                      |
      v                      v
Encrypted Credential      Provider Connectors
Vault                     - OAuth / API
      |                      |
      +----------+-----------+
                 |
                 v
        Isolated Execution Layer
        - website browser workers
        - session isolation
        - credential injection
        - output sanitization
                 |
                 v
        Third-party websites / APIs
~~~

### 3.1 Security gateway
Authenticate developers and agents; resolve tenant/user delegation; validate account ownership and origins; evaluate policies and approvals; issue, validate, expire, and revoke grants; authorize every operation; enforce rate limits/idempotency; emit audit events.

### 3.2 Credential vault
Secure enrollment and ingestion; encrypted credential storage; envelope encryption and key versioning; narrowly authorized decryption; credential update, rotation, revocation, and deletion. No plaintext retrieval endpoint for agents.

### 3.3 Execution layer
Execute website login in isolated browser contexts; run OAuth/API connectors without exposing tokens; retrieve secrets only inside trusted execution; validate origins and redirects before injection; sanitize outputs; support MFA/user handoff; enforce timeouts, resource limits, network controls, and cleanup.

Browser execution must use an AgentLogin-owned abstraction. Browser provider and deployment choice remain open. Do not couple AgentLogin to Chusky or another private agent/browser system.

### 3.4 User control plane
Connected-account management; agent registration/delegation; policy and approval settings; active grants/sessions; audit history; revoke/disconnect controls.

## 4. Security model and invariants

### 4.1 Secret boundary
Plaintext credentials may exist only briefly inside trusted enrollment or execution processes. They must never cross into agent-facing APIs, SDK objects, MCP results, logs, traces, analytics, screenshots, browser debugging interfaces, or error messages.

### 4.2 Grant binding
Every grant is bound server-side to tenant, user, authenticated agent, connected account, normalized origin/provider, exact scopes, issued-at/expiry, policy version, approval reference, and execution/task context where applicable.

Every operation validates the grant server-side. An unguessable grant ID is not sufficient: caller must authenticate as the bound agent and satisfy the bound context.

### 4.3 Website origin protection
- Normalize origin as scheme + hostname + effective port.
- Reject malformed, opaque, unsupported, or ambiguous origins.
- Do not use substring, suffix, or display-name checks for authorization.
- Validate every redirect before credential injection.
- Deny lookalike domains and untrusted cross-origin frames unless an explicit reviewed policy allows them.
- Never autofill based only on visual similarity to the expected login page.

### 4.4 Browser isolation
- Isolate browser process/context, profile, cookies, storage, downloads, and temporary files by user/session.
- Never expose CDP, DevTools, remote debugging, profile files, cookies, storage, raw network data, or unrestricted inspection to agents.
- Redact/suppress passwords and authentication fields from screenshots, DOM, accessibility data, page text, and returned artifacts.
- Treat page content as untrusted; prompt injection cannot alter policy or request secrets.
- Defend against SSRF, DNS rebinding, private-network access, metadata endpoints, and redirect abuse.
- Do not bypass MFA, CAPTCHA, or user-presence challenges; pause for secure user handoff.
- Clean up sessions on expiry/revocation.

### 4.5 Cryptography and key custody
Initial design target:
- envelope encryption;
- cryptographically secure DEK per credential/isolated record;
- authenticated encryption such as AES-256-GCM;
- DEK wrapped by KMS-managed key;
- authenticated associated data binds tenant, credential, version, and purpose;
- ciphertext and wrapped key stored separately from application config;
- narrowly scoped decrypt permissions;
- key rotation and revocation lifecycle.

Key custody is not finalized. A managed KMS adapter may be used initially, but preserve a path to customer-managed keys/BYOK. Do not claim zero-knowledge or operator-inaccessible plaintext merely because data is encrypted at rest or a KMS is used.

### 4.6 Audit and logging
Audit actor, tenant, agent, account reference, origin/provider, scope, policy decision, approval, grant, execution, timestamps, and result category. Never log passwords, tokens, cookies, auth headers, recovery codes, private keys, decrypted payloads, or raw secret-bearing browser traces. Use structured logs, redaction, access controls, retention policies, and safe correlation IDs.

## 5. Authorization model

Initial scope:
- autofill_login: authorize AgentLogin to perform login autofill for the specific connected account and exact origin.

Do not introduce broad browser_access or full_access scopes.

Potential future scopes, each requiring separate policy and tests:
- page_read
- form_fill
- file_upload
- file_download
- provider-specific read/search/create actions
- high-risk write actions with explicit approval

Default policy:
- login/autofill: only under explicit user delegation and scope;
- read/search: only when granted;
- draft/create: configurable, potentially approval-gated;
- send/publish/purchase/transfer: approval required by default;
- delete, recovery-setting changes, adding authentication factors, ownership changes: deny by default until a high-assurance flow exists.

Login permission does not imply permission to make arbitrary changes after login.

## 6. Proposed API surface

These are proposed contracts, not claims that endpoints already exist. Version and document exact schemas before implementation.

### 6.1 Agent identity
- POST /v1/agents — register an agent under a developer/tenant.
- POST /v1/agent-sessions — authenticate an agent using an issued agent credential or supported workload identity.
- GET /v1/agents/{agent_id}/accounts — list only accounts delegated to the agent; safe metadata only.

Agent credentials must be revocable, scoped, and rotated. Do not reuse developer API keys as unrestricted agent credentials.

### 6.2 Grant request

POST /v1/grants

Illustrative request:

~~~json
{
  "agent_id": "agt_...",
  "account_id": "acc_...",
  "origin": "https://accounts.example.com",
  "scopes": ["autofill_login"],
  "task_id": "task_...",
  "requested_ttl_seconds": 300
}
~~~

Illustrative approved response:

~~~json
{
  "status": "approved",
  "grant_id": "grt_...",
  "origin": "https://accounts.example.com",
  "expires_at": "2026-11-07T19:31:00Z",
  "scopes": ["autofill_login"]
}
~~~

Other outcomes must be explicit and typed, e.g. pending_approval or denied. Never return an approved grant before policy authorization is complete.

### 6.3 Execute login

POST /v1/grants/{grant_id}/login

The authenticated agent submits the grant reference and safe execution context. AgentLogin validates bound agent, account, origin, scope, expiry, and revocation, then executes internally.

Return outcome only, such as:
- login_succeeded
- mfa_required
- user_action_required
- login_failed
- grant_expired
- grant_revoked
- origin_mismatch
- scope_denied

Never return credential values, cookies, tokens, raw headers, or unrestricted browser handles.

### 6.4 Controls
- GET /v1/grants/{grant_id} — safe status for authorized callers.
- DELETE /v1/grants/{grant_id} — revoke grant.
- POST /v1/accounts — begin secure account enrollment.
- DELETE /v1/accounts/{account_id} — disconnect and revoke related access.
- GET /v1/audit-events — authorized, secret-free audit history.

### 6.5 MCP tools
Expose task-level tools, not secret retrieval:
- list_connected_accounts
- request_access
- login_with_grant
- get_execution_status
- request_user_action
- revoke_grant (only where agent policy permits)

MCP outputs obey the same grant and secret boundary as REST. Tool descriptions explicitly state that credentials are never returned.

## 7. Data model proposal

Conceptual schema; adapt to selected database. Every tenant-owned record must be tenant-scoped.

| Entity | Important fields |
|---|---|
| tenants | id, name, plan, created_at |
| users | id, tenant_id, auth_subject, status |
| developers | id, tenant_id, name, status |
| agents | id, tenant_id, developer_id, name, identity_type, status |
| connected_accounts | id, tenant_id, user_id, provider, origin, display_label, status |
| credentials | id, tenant_id, account_id, credential_type, ciphertext_ref, wrapped_dek, key_version, version, status |
| delegations | id, tenant_id, user_id, agent_id, account_id, policy_id, status |
| policies | id, tenant_id, owner_id, rules, version, status |
| grants | id, tenant_id, user_id, agent_id, account_id, origin, scopes, issued_at, expires_at, policy_version, status |
| approvals | id, tenant_id, grant_request_id, requested_by, decision, decided_by, decided_at |
| executions | id, tenant_id, grant_id, operation, status, started_at, completed_at, safe_result_code |
| audit_events | id, tenant_id, actor_type, actor_id, event_type, resource_ref, decision, timestamp, correlation_id |

Store secret ciphertext in dedicated encrypted storage where possible; ordinary metadata tables should contain references and cryptographic metadata, not plaintext. Enforce cross-tenant isolation in database constraints and service authorization. Define retention and deletion semantics.

## 8. Implementation milestones

Status values: NOT STARTED, IN PROGRESS, BLOCKED, DONE. Update only with repository evidence.

### Milestone 0 — Repository and threat-model foundation
**Status: DONE — foundation and architecture are in place; continue maintaining threat-model and security-review evidence.**

Deliverables:
- inspect current repository stack, conventions, and existing implementation;
- define trust boundaries, attacker capabilities, assets, threats, mitigations, and residual risks;
- establish security review checklist and secret-handling rules;
- define API versioning, error format, and ID conventions;
- choose initial deployment/database/KMS direction with recorded rationale.

Acceptance:
- threat model reviewed before real credential handling;
- no production secrets in repository;
- architecture decisions recorded, not silently assumed;
- CI runs formatting, lint, type checks, and baseline tests.

### Milestone 1 — Identity, tenant isolation, developer onboarding
**Status: IN PROGRESS — core repositories, agent authentication, Fastify middleware, and OIDC/membership code paths exist. Finish provider configuration and deployed end-to-end verification.**

Deliverables:
- developer account/project model;
- tenant and user identity model;
- agent registration and revocation;
- authenticated developer and agent credentials;
- scoped API authentication and rate limits;
- safe connected-account metadata.

Acceptance:
- cross-tenant access tests pass;
- agents cannot impersonate other agents/users;
- credentials can be rotated and revoked;
- every request has verified tenant and actor context.

### Milestone 2 — Secure enrollment and credential vault
**Status: IN PROGRESS — envelope encryption, durable credential storage, lifecycle routes, and AWS KMS adapter exist. Live synthetic Neon + KMS vault lifecycle test passed all 8 checks; synthetic data and temporary diagnostic variables were removed, and the diagnostic endpoint returns 404. Secure user-facing enrollment, unrelated-key denial, KMS outage behavior, CloudTrail review, recovery, and rotation procedures remain open.**

Deliverables:
- secure hosted enrollment;
- credential ingestion and validation;
- envelope-encryption service and KMS adapter;
- ciphertext storage, key versioning, and access controls;
- update, rotation, disconnect, and deletion lifecycle.

Acceptance:
- plaintext never appears in agent responses, logs, traces, analytics, or snapshots;
- only narrowly authorized execution identity can decrypt;
- tenant/credential binding is authenticated;
- encryption/decryption and key-rotation tests pass;
- secret scanning enabled in CI.

### Milestone 3 — Grant, policy, and approval engine
**Status: IN PROGRESS — persistent grant/approval lifecycle and API routes exist, and the dashboard approval inbox is integrated. End-to-end verification and adversarial/concurrency gates remain.**

Deliverables:
- grant request endpoint and typed response;
- exact-origin normalization and matching;
- policy evaluation;
- user approval/denial flow;
- short-lived grants and revocation;
- grant-bound execution authorization;
- secret-free audit events.

Acceptance:
- approved response matches documented grant contract;
- no raw credentials returned;
- wrong agent, tenant, account, origin, scope, expired/revoked grant rejected;
- grant ID alone cannot authorize a request;
- approval-required requests cannot execute before approval;
- replay and concurrent-use behavior tested and documented.

### Milestone 4 — Website login execution
**Status: IN PROGRESS — provider-neutral coordinator and grant-bound checks exist; isolated browser worker, credential broker, and MFA/CAPTCHA handoff remain open.**

Deliverables:
- provider-neutral browser execution interface;
- isolated browser worker and provider evaluation;
- credential injection within trusted worker;
- origin/redirect validation;
- login result reporting;
- MFA/CAPTCHA user handoff and resume;
- output sanitization and browser cleanup.

Acceptance:
- test websites verify successful login without credential exposure;
- malicious/lookalike origins and redirect attacks blocked;
- agent cannot inspect cookies, storage, headers, profile files, CDP, or raw traces;
- password fields and sensitive page regions redacted;
- MFA/CAPTCHA handed to user, not bypassed;
- isolation, timeout, cleanup, and revocation tests pass.

### Milestone 5 — SDK, REST docs, MCP
**Status: IN PROGRESS — typed TypeScript SDK and authenticated Streamable HTTP MCP transport are implemented and deployed. npm publication and authenticated remote smoke tests remain open; login execution tools remain blocked on the isolated browser worker. Durable webhook database/worker foundations are merged and deployed disabled; endpoint-management APIs/SDK and dashboard SSE remain open.**

Deliverables:
- TypeScript SDK;
- REST/OpenAPI docs;
- MCP server and task-level tools;
- typed grant and execution result models;
- generic agent integration example;
- webhooks and idempotency support.

Acceptance:
- sample agent requests grant, executes login, receives safe result;
- no secret-returning method in public SDK/MCP;
- SDK tests cover expiry, denial, revocation, wrong-origin, and MFA-required;
- quickstart uses fake accounts only.

### Milestone 6 — Security hardening and private beta
**Status: IN PROGRESS — foundational tests and deployment exist; full adversarial/concurrency review, independent security review, operational recovery, and private-beta release gates remain.**

Deliverables:
- independent security review/penetration test plan;
- abuse, rate-limit, replay, SSRF, DNS rebinding, prompt-injection testing;
- key rotation and incident response procedures;
- audit access and retention controls;
- backup/restore and disaster recovery review;
- privacy, terms, and data-processing documentation;
- operational dashboards and alerts with safe telemetry.

Acceptance:
- no unresolved critical/high findings before production credentials;
- incident response and credential-compromise playbook documented;
- revocation and deletion verified end-to-end;
- security invariants have automated coverage where practical;
- private-beta scope and limitations explicit.

## 8. Current implementation snapshot — 8 November 2026

The current state of the repository is summarized in [docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md). The snapshot distinguishes code that exists from production configuration and end-to-end verification.

Implemented foundations include:
- Neon PostgreSQL, Drizzle migrations, tenant-scoped repositories, and FORCE RLS on current tenant-owned tables plus the separate webhook delivery queue.
- Persistent agent credential repository, signed HMAC agent tokens, and Fastify authentication middleware.
- Auth0/OIDC user/developer authentication path, tenant membership model, and onboarding/agent-management API routes. Auth0 organization tenant-claim configuration and deployed verification remain open.
- AWS KMS wrap/unwrap adapter, AES-256-GCM envelope encryption, durable credential-envelope storage, and credential lifecycle API routes. Live synthetic Neon + KMS lifecycle verification passed all 8 checks; synthetic records and temporary diagnostic variables were removed, and the diagnostic endpoint returns 404.
- Persistent grants, delegations, approvals, policy checks, API routes, and dashboard approval inbox integration.
- Railway API, web, MCP, and webhook worker services are deployed; all four production services are online. API pre-deploy migrations succeeded after PR #49.

Still open:
- Complete trusted Auth0 organization/tenant claim setup and verify real user-to-API authorization.
- Complete unrelated-key denial, KMS outage/failure behavior, CloudTrail identity/actions, and key recovery/rotation procedures.
- Finish the user-facing secure credential enrollment flow.
- Build and verify the isolated browser worker and MFA/CAPTCHA user handoff.
- Publish the SDK/contracts packages and complete authenticated remote MCP smoke tests; browser login execution tools remain intentionally unavailable until the isolated worker is complete.
- Durable webhook schema, queue worker, queue RLS/FORCE RLS, dedicated NOLOGIN executor, and HMAC/KMS/SSRF protections are implemented and deployed with worker disabled. PRs #41, #42, #44, #47, #48, and #49 are merged.
- Complete webhook API/SDK management, domain-event transaction wiring, dashboard SSE/polling, and end-to-end security/reliability tests.
- Run runtime-role database integration, adversarial, replay, concurrency, and secret-leak tests; complete independent security review.

Do not treat an implemented adapter, API route, migration, or dashboard screen as proof that the full user-facing workflow is production-ready. The production credential gate in `docs/IMPLEMENTATION_STATUS.md` remains authoritative.
 
## 9. Test strategy

Build security tests alongside every feature.

Grant tests:
- approved grant returns only documented schema;
- denied/pending requests cannot execute;
- wrong tenant, user, agent, account, origin, or scope rejected;
- expired/revoked grants rejected;
- tampered metadata rejected;
- replay, concurrency, and idempotency behavior correct.

Credential-exposure tests:
- API, SDK, MCP, logs, traces, metrics, errors, screenshots, DOM, accessibility output, and artifacts do not contain synthetic passwords/tokens;
- worker receives credentials only after authorization;
- agent cannot access profile, cookies, storage, headers, or debugging ports;
- exception/timeout paths do not leak secrets.

Browser/origin tests:
- exact origin accepted;
- scheme/port mismatch rejected;
- lookalike host rejected;
- redirect to another origin blocked before autofill;
- untrusted cross-origin frame cannot receive credentials;
- page prompt injection cannot alter policy;
- SSRF/private network/metadata targets blocked;
- MFA/CAPTCHA produces user-action-required state.

Isolation tests:
- no cross-tenant account/credential access;
- no cross-agent grant use;
- no session/profile/download/clipboard leakage;
- revocation stops subsequent operations and terminates active execution where possible.

Use synthetic test accounts and credentials only.

## 10. Initial technology direction and open decisions

No specific stack is confirmed by this plan. Keep adapters/interfaces so choices can change without changing the product contract.

| Decision | Current direction | Status |
|---|---|---|
| Audience | Agents first; developers integrate their own systems | PRODUCT REQUIREMENT |
| Initial capability | Website login with opaque grants | PROPOSED |
| Agent response | Approved grant, never raw credentials | NON-NEGOTIABLE |
| Browser execution | AgentLogin-owned provider-neutral adapter | OPEN |
| Chusky integration/browser | Explicitly excluded | NON-NEGOTIABLE |
| Key custody | Managed KMS may be initial; preserve BYOK path | OPEN |
| Database/storage | Decide after repo and threat-model review | OPEN |
| Hosting/runtime | Decide after repo and threat-model review | OPEN |
| SDK | TypeScript first | PROPOSED |
| Agent integration | REST + MCP | PROPOSED |
| OAuth/API connectors | Add after core grant and website-login model | PROPOSED |

Create architecture decision records for:
1. hosting/runtime and trust boundaries;
2. database and encrypted blob storage;
3. KMS provider and key hierarchy;
4. browser execution provider and isolation model;
5. agent authentication/workload identity;
6. user authentication/passkey strategy;
7. grant TTL, revocation, replay, single-use/reusable semantics;
8. supported websites/providers and enrollment UX;
9. audit retention and privacy;
10. BYOK/customer-managed keys.

## 11. Recommended delivery order

1. Repository inspection and threat model.
2. Tenant/user/developer/agent identity.
3. Secure credential enrollment and encrypted vault.
4. Grant/policy/approval engine.
5. Isolated website login execution.
6. TypeScript SDK, REST docs, and MCP.
7. Security hardening and private beta.
8. OAuth/API connector expansion.

Do not start by building a broad browser automation product. The differentiator is the secure boundary between agent intent, user authorization, secret custody, and controlled execution.

## 12. First meaningful product milestone

A developer connects AgentLogin to an agent system. A user securely connects a website account and delegates a narrowly scoped login capability. The agent requests access and receives the opaque grant object. AgentLogin performs login inside its isolated execution environment. The agent receives a useful, sanitized result—but cannot obtain the user's password, tokens, cookies, or session secrets.

That end-to-end proof, with adversarial tests demonstrating the secret boundary, is the first meaningful product milestone.

## 8B. Current implementation snapshot — 8 November 2026

This section reflects the current `main` implementation plus the active integration work described in [docs/REMAINING_WORK.md](./docs/REMAINING_WORK.md). “Implemented” means code exists; it does not imply that external provider configuration or production end-to-end verification is complete.

| Area | Implemented now | Still open / release boundary |
|---|---|---|
| Agent identity | Persistent agent credential repository; 256-bit random credential secrets; SHA-256 hashes stored in PostgreSQL; HMAC-signed tenant-bound agent tokens; Fastify authentication with expiry, revocation, tenant, developer, and agent-state checks. | Key-ring rotation, migration of legacy unsigned tokens where applicable, abuse controls, and full adversarial/concurrency verification. |
| User identity and onboarding | Auth0/OIDC JWT verification with issuer, audience, JWKS signature, allowed algorithm, token expiry/age, and trusted tenant claim; membership lookup; idempotent first-user onboarding repository and API route. | Finish Auth0 Post-Login Action and Login-flow setup; verify Railway OIDC variables and live tokens; test token renewal, organization membership, and owner/admin boundaries. |
| Tenant isolation | Tenant-scoped PostgreSQL repositories, transaction-local tenant context, RLS and FORCE RLS on the current tenant-owned tables, separate least-privilege runtime and migration roles. | Continue testing with the actual Neon runtime role; verify all cross-tenant and membership denial cases after migrations. |
| Credential vault | AES-256-GCM envelope encryption, callback-scoped decryption, durable encrypted credential records, versioned credential rotation, account disconnect/revocation, and AWS KMS provider. | Live synthetic Neon + KMS lifecycle test passed all 8 checks; synthetic data and temporary diagnostic variables removed; diagnostic endpoint returns 404. Complete secure user-facing enrollment/handoff, unrelated-key and outage tests, CloudTrail review, and recovery/rotation procedures. Do not store real credentials yet. |
| Grants and approvals | Persistent grant and approval repositories; delegation checks; pending grant request; user approve/deny/revoke routes; expiry/revocation checks; scoped authorization; secret-free audit events. | Verify end-to-end against deployed Auth0/API configuration, including wrong-owner, cross-tenant, replay, expiry, race, and concurrency cases. |
| Dashboard | Next.js 16 dashboard with account, agent, grant, approval, activity, and security sections; mobile responsiveness; light/dark themes; server-side connected-account and approval API calls; first-use onboarding merged in PR #31. | Verify Auth0-backed onboarding, connected-account and approval flows in production; complete account enrollment UI and remaining coming-soon workflows. |
| SDK and MCP | Typed TypeScript SDK supports agent identity, grant requests, and grant-status lookup; authenticated Streamable HTTP MCP tools verify AgentLogin agent tokens. Separate Railway MCP service is deployed. | Publish SDK/contracts to npm and run authenticated remote smoke tests. Login execution remains unavailable until the isolated browser worker is built and verified. |
| Login execution | Provider-neutral execution interfaces/coordinator and grant-bound authorization checks exist. | Concrete isolated browser worker, credential broker, origin/redirect/SSRF protections, output sanitization, session cleanup, and user-mediated MFA/CAPTCHA handoff remain open. |
| Deployment and tests | Neon database; Railway API, web, MCP, and webhook worker all online; API migration and health check succeeded. Vault lifecycle synthetic test passed 8 checks. | Verify current CI, production runtime-role integration tests, KMS/Auth0 end-to-end behavior, webhook delivery gates, operational recovery, and independent security review. |

### External configuration still required

**Auth0**
- API audience: `https://api.agentlogin.app`.
- Organization: `AgentLogin Workspace` (`org_fBUW065W2Ut6KHbt`).
- Complete the Post-Login Action and attach it to the Login flow so the signed access token contains `https://agentlogin.app/tenant_id` from the authenticated Organization context.
- Verify the API service has `OIDC_ISSUER_URL`, `OIDC_AUDIENCE`, `OIDC_JWKS_URL`, `OIDC_TENANT_CLAIM`, and `OIDC_MAX_TOKEN_AGE`. The max token age defaults to 24 hours and must align with the Auth0 API token lifetime.
- Verify web service Auth0 variables, audience, Organization, and `AGENTLOGIN_API_URL`.

**AWS KMS**
- KMS key alias: `alias/agentlogin-vault`.
- Region: `us-east-1`.
- Key ARN: `arn:aws:kms:us-east-1:471742380391:key/ce73891f-9bca-41ea-b9dc-e4555703b4fd`.
- Create the least-privilege `AgentLoginVaultKmsUseOnly` IAM policy, a dedicated IAM service user with no console access, and a programmatic key.
- Put AWS credentials and `AWS_REGION` / `AWS_KMS_KEY_ID` on the Railway API service only. Never place them in the web service, Git, or chat.
- Verify KMS Encrypt/Decrypt, wrong-context denial, key mismatch, failure behavior, and secret-free logging.

### Migration and rollout notes

- The current main branch has the Drizzle baseline migration applied to Neon. The new opt-in integration test requires an existing dedicated synthetic tenant/user and the non-owner runtime database role. Do not use `drizzle-kit push` against production.
- Keep the migration role separate from the runtime role. Verify RLS and FORCE RLS after every schema change using the actual non-owner runtime role.
- The dashboard's first-use onboarding integration is being added on the active PR; verify CI and deployed behavior after merge.
- A healthy Railway health endpoint does not prove Auth0, KMS, credential enrollment, grant execution, or browser isolation is ready.

### Release blockers before real credentials

1. Complete Auth0 Organization claim configuration and prove the deployed user-to-API onboarding flow.
2. Configure the restricted AWS IAM identity and Railway API KMS variables; pass positive and negative end-to-end encryption tests.
3. Complete the secure user-facing credential enrollment, update, disconnect, and recovery experience.
4. Implement and adversarially test the isolated browser worker, credential broker, origin/redirect/SSRF protections, and MFA/CAPTCHA handoff.
5. Complete SDK and MCP transports with authenticated identity, scoped grants, and sanitized results.
6. Run cross-tenant, membership, replay, expiry, revocation, concurrency, and secret-leak tests; complete independent security review.

No production website password, OAuth token, cookie, or API key should be entered until all production credential gates are passed.


## 8C. Production hardening update — 10 November 2026

This update supersedes earlier deployment and KMS notes where they conflict. It records the latest directly observed production state; a healthy deployment is not equivalent to production credential-execution acceptance.

### Verified in this pass

- Railway production reports all five services online with one running replica each and zero active warnings/critical alerts or recent failures. The API deployment on commit `5b582bd431721aef781231e70861e62b51176191` reached `SUCCESS`.
- API runtime logs explicitly report: `Login execution routes are disabled: configure AGENTLOGIN_WORKER_URL and a valid AGENTLOGIN_WORKER_TICKET_SIGNING_KEY.` The API `/health` check returned HTTP 200. This runtime log—not variable-name presence—is the evidence that the route is currently disabled.
- The user-run live AWS KMS permission probe passed: allowed `website_login` decrypt succeeded with synthetic fixture material; wrong-purpose decrypt was denied; Encrypt, GenerateDataKey and GenerateDataKeyWithoutPlaintext were denied. The reported caller was IAM user `agentlogin-vault-service`. This proves that caller's tested policy path, not that the deployed isolated worker uses a separate, dedicated identity.
- Connected directly to Neon as `agentlogin_worker` for read-only inspection. The role is not superuser, does not have `BYPASSRLS`, cannot create roles or databases, and has only column-level SELECT grants on the credential-envelope columns and `connected_accounts(id, tenant_id, status)`.
- The `credentials` and `connected_accounts` tables both have RLS and FORCE RLS enabled. As `agentlogin_worker`, INSERT/UPDATE/DELETE on credentials and SELECT on grants/credential leases are denied. With no tenant context, the role sees zero credential and connected-account rows.
- PR #104's worker-specific integration test and CI evidence remain recorded in `track.md`: it exercises two synthetic tenants, missing-tenant fail-closed behavior, exact grants, read-only restrictions and tenant A/B isolation.
- The API's temporary KMS fixture variables `AWS_KMS_TEST_CIPHERTEXT_B64` and `AWS_KMS_TEST_PLAINTEXT` were overwritten with empty values in Railway to neutralize any leftover fixture content. Railway's available variable action does not delete the names; verify the new API deployment before treating cleanup as live.
- Credential enrollment remains unconfigured/disabled. Do not enroll real credentials.

### Still blocking production login acceptance

1. Verify the new API deployment after the KMS-fixture-variable cleanup and retain the startup log proving execution routes remain disabled.
2. Prove the deployed login worker uses a dedicated AWS principal distinct from the API principal. The local KMS test's caller identity is not sufficient evidence of worker runtime identity. Verify the worker's effective KMS key policy and decrypt-only/context restrictions, including unrelated-key and administrative-action denial.
3. Recheck a live `agentlogin_worker` connection from the deployed worker after its latest restart. A direct Neon login as that role proves the role and grants work, but an empty current `pg_stat_activity` result does not prove the Railway process is presently connected.
4. Run tenant A/B RLS tests with synthetic fixtures in a disposable database or controlled rollback-only transaction; do not seed production user data.
5. Verify API-to-worker private connectivity and invalid-ticket rejection from trusted service runtimes; then run synthetic one-time lease execution only in a controlled non-production fixture.
6. Provision a public-DNS HTTPS synthetic login fixture and run success, invalid-password, MFA-challenge and negative origin/redirect/SSRF/replay/revocation/timeout tests. MFA resume remains unsupported.
7. Complete independent security review, rollback evidence, and operational recovery before any real credential enrollment.

**Release rule:** keep login execution routes and credential enrollment disabled until every gate above has evidence. Never treat Railway health, deployment success, KMS success under a different principal, or role-level SQL checks in isolation as end-to-end acceptance.


## 8D. Worker AWS runtime identity attestation — 10 November 2026

PR #110 is merged and deployed. The isolated login worker is online on commit `26b4803a64f190711212ee8f7dfd493015ee31f3`. Its startup STS attestation logged AWS account `471742380391` and caller ARN `arn:aws:iam::471742380391:user/agentlogin-vault-service`. This matches the principal reported by the successful local synthetic KMS permission probe. It proves the worker's effective identity, but does not prove a separate API principal; the API must not receive credential-decryption access.

The worker startup attestation is fail-closed: STS identity resolution happens before the worker listens. No AWS credential values are logged.

The API deployment containing the same merge is still rolling out. Existing API runtime logs show the login execution gate remains disabled. The API configuration decoder requires a canonical 32-byte base64url key (43 characters); variable-name presence alone is insufficient. A follow-up change is being prepared to log only safe booleans for URL configured/valid and signing-key configured/valid, without exposing values.

Continue to keep execution and enrollment disabled until API configuration is valid, private API-to-worker connectivity and ticket rejection are tested, and synthetic end-to-end/adversarial login acceptance is complete. The worker's matching IAM identity does not by itself satisfy those release gates.
