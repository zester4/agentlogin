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
**Status: NOT STARTED**

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
**Status: IN PROGRESS**

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
**Status: NOT STARTED**

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
**Status: NOT STARTED**

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
**Status: NOT STARTED**

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
**Status: NOT STARTED**

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
**Status: NOT STARTED**

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

## 8A. Verified implementation evidence — 7 November 2026

The following foundations are present in the repository and deployed environment. These do not constitute completion of the milestones below.

- Fastify API scaffold, database-aware readiness route, and Railway deployment.
- Neon PostgreSQL with Drizzle schema and generated baseline migration.
- Twelve tenant-owned tables with RLS enabled and FORCE ROW LEVEL SECURITY verified on all twelve.
- Separate runtime and migration database roles; both inspected roles are non-superuser and have BYPASSRLS disabled.
- Envelope-encryption primitives and a KMS provider interface; production KMS adapter is not selected or deployed.
- Opaque agent credential issuance/verification service with hashed token storage and lifecycle checks.
- Tenant-scoped Postgres agent-credential repository adapter added in the current implementation branch. It binds each repository instance to a verified tenant context and uses transaction-local RLS context for every operation.
- Repository adapter intentionally does not perform global credential-ID resolution. A safe bootstrap authentication lookup must be designed before a live agent-authentication endpoint is exposed.

Current gaps before Milestone 1 can be called done:
- No production user/developer identity provider or authenticated user session flow.
- No trusted tenant-resolution/bootstrap authentication path for agent credentials.
- No API authentication middleware wired to the repository and identity service.
- No production agent registration/onboarding and credential rotation endpoints.
- No actual tenant-isolation integration test executed against Neon using the runtime role.
- No grant/approval lifecycle or browser execution implementation.

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

## 8B. Security and lifecycle implementation update — 7 November 2026

The following implementation work is present on the current review branch. It is not considered live until the branch passes CI, merges, and its Railway deployment and migrations are verified.

| Area | Implemented in code | Not yet complete / external dependency |
|---|---|---|
| 1. Agent identity bootstrap | Opaque agent tokens now carry an HMAC-SHA256-authenticated tenant claim. The API verifies the signature before constructing a tenant-bound repository; the secret remains SHA-256 hashed in PostgreSQL. | Key IDs/key-ring rotation and migration of any tokens issued in the previous unsigned format. |
| 2. API authentication | Fastify agent auth middleware and a protected identity endpoint. Generic OIDC JWT verification validates issuer, audience, JWKS signature, allowed algorithms, token age, and a signed tenant claim. | Configure a real OIDC issuer, audience, JWKS URL, and trusted tenant claim. Production rate limiting, abuse controls, and operational monitoring still need hardening. |
| 3. User/developer onboarding | OIDC identity-to-user resolution under RLS; first-user workspace/developer onboarding; developer membership model; authenticated developer and agent creation routes. | No OIDC provider is selected/configured. Invitations, multi-user organization management, passkeys, account recovery, and billing are not implemented. |
| 4. Credential lifecycle | One-time agent token issuance, atomic agent-token rotate-and-revoke, individual revocation; user website credential enrollment, versioned encrypted rotation, and account disconnect that revokes credentials, delegations, and grants in one tenant transaction. | Runtime-role integration tests against Neon and an operational recovery flow for lost one-time tokens. |
| 5. Grants and approvals | Tenant-scoped PostgreSQL grant/approval repository, user-controlled delegation and revocation routes, pending grant request, owner-only approve/deny/revoke routes, expiry/revocation checks, exact account/origin/scope/policy authorization, live entity status checks, and secret-free audit writes. | End-to-end user-to-agent flow and runtime-role integration tests against Neon remain. |
| 6. Credential vault and KMS | User-authenticated connected-account enrollment and credential rotation routes; credential context binds tenant, account, credential ID, version, and purpose in AES-GCM AAD. PostgreSQL record store persists ciphertext, IV, tag, wrapped DEK, key version, and revocation state. AWS KMS adapter wraps/unwraps DEKs with encryption context and records the immutable KMS key ARN. | No AWS KMS key, region, IAM role/credentials, or production KMS configuration is configured. Do not store real website credentials yet. |
| 7. Isolated login execution | Provider-neutral execution coordinator checks the grant before account lookup, binds worker request to tenant/user/agent/account/origin/credential version, audits denials and outcomes, sanitizes the agent-facing result, and destroys completed/failed sessions. | No concrete isolated browser worker/provider, credential-broker integration inside that worker, secure MFA handoff/resume UI, or browser-origin/redirect/SSRF adversarial integration suite is deployed. |

### Required runtime configuration

- `AGENT_TOKEN_SIGNING_KEY`: Railway secret, canonical base64url encoding of 32 cryptographically random bytes. It must remain stable across deploys. Do not rotate by replacing it without a key-ID/key-ring migration.
- `OIDC_ISSUER_URL`, `OIDC_AUDIENCE`, `OIDC_JWKS_URL`, `OIDC_TENANT_CLAIM`: configure only after choosing an OIDC provider and ensuring the tenant claim is issued by that trusted provider. The tenant claim is never accepted from an ordinary request header or body.
- `AWS_REGION`, `AWS_KMS_KEY_ID`: configure after creating a dedicated KMS key and least-privilege runtime IAM access. The API needs data-key wrap/unwrap permissions only; key administration belongs to a separate operator role.

### Migration and rollout gates

The current review branch adds migrations for credential envelope metadata and developer memberships, and updates the FORCE RLS migration script to include the new membership table. These migrations must not be treated as applied to Neon until the branch is merged and the Railway pre-deploy migration completes successfully. Verify RLS and FORCE RLS on all thirteen tenant-owned tables after rollout.

The signed agent token format is intentionally incompatible with the previous unsigned format. Re-issue credentials through the authenticated rotation flow before relying on the new middleware. Never log or copy a token into a support ticket.

### Release blockers before real credentials

1. Configure and verify OIDC, then test first-user onboarding and owner/admin authorization using a real test tenant.
2. Run cross-tenant and membership integration tests against Neon using the runtime role (not the database owner).
3. Create a dedicated AWS KMS key, configure workload credentials, and run encrypt/decrypt, wrong-context, key-rotation, and revocation tests.
4. Implement a concrete isolated browser worker with per-execution profiles, origin/redirect enforcement before autofill, SSRF/private-network blocking, no CDP exposure, and MFA handoff/resume.
5. Wire account enrollment and grant/approval HTTP routes; prove the full end-to-end flow using synthetic accounts.
6. Run independent security review and secret-leak tests across logs, traces, errors, screenshots, DOM, artifacts, and worker IPC.

No production website password, OAuth token, cookie, or API key should be entered until those gates are passed.
