# AGENT.md

## Mission

Build AgentLogin: an agent-first identity, credential-protection, authorization, and controlled-login platform.

Agents and developer-built agent systems use AgentLogin to authenticate to websites and services on behalf of users. AgentLogin keeps passwords, API keys, OAuth tokens, cookies, recovery codes, and other authentication material out of the agent's possession.

**The agent receives an approved, short-lived capability grant and the results of permitted operations. It never receives the user's credentials.**

## Product boundary: independent product

AgentLogin is a standalone product and codebase.

- Do not import, depend on, integrate, or couple AgentLogin to Chusky.
- Do not assume Chusky's browser, browser fork, infrastructure, APIs, credentials, or roadmap are available to AgentLogin.
- Do not reuse Chusky branding, product language, internal architecture, or implementation details.
- AgentLogin must own its interfaces and remain usable by agents and developer systems regardless of agent framework or browser provider.
- Browser execution must sit behind a provider-neutral interface. Any browser provider is evaluated independently. Chusky is not a dependency or default.

## Non-negotiable product contract

An agent may receive:

~~~json
{
  "status": "approved",
  "grant_id": "grt_...",
  "origin": "https://accounts.example.com",
  "expires_at": "2026-11-07T19:31:00Z",
  "scopes": ["autofill_login"]
}
~~~

An agent must never receive:

~~~json
{
  "email": "user@example.com",
  "password": "..."
}
~~~

The grant is an opaque authorization handle, not a credential and not blanket permission. Every operation using it must be checked server-side against its bound agent, user, tenant, account, origin, scope, expiry, policy, and revocation state.

Never add passwords, login secrets, API keys, access/refresh/ID tokens, cookies, bearer session identifiers, recovery codes, private keys, or equivalent secrets to agent-facing responses.

## Core principles

1. **Secrets stay inside the security boundary.** Decrypt only inside trusted enrollment or execution processes, for the minimum time required.
2. **Grant, don't reveal.** Agents receive scoped, expiring, revocable grants and sanitized operation results.
3. **Authorize every operation.** A grant ID alone is never sufficient authorization.
4. **Least privilege.** Bind access to the requested account, exact origin, operation, and duration.
5. **User intent controls access.** Users connect accounts and define delegation. Sensitive actions require approval or are denied.
6. **Isolation is a security boundary.** Separate browser sessions, connector processes, temporary files, logs, and debugging interfaces across users, tenants, agents, and tasks.
7. **Revocation works.** Users and policy systems can revoke grants, sessions, agents, and connected accounts. Enforce revocation on every subsequent operation and terminate active sessions where possible.
8. **Audit without secrets.** Record actor, account reference, origin, scope, decision, approval, timestamps, and result—not credential values.
9. **Fail closed.** If authorization, origin validation, expiry, policy, secret retrieval, or audit requirements fail, do not execute.
10. **Be honest about guarantees.** Encryption at rest is not zero-knowledge security. Never claim operators cannot access plaintext unless the architecture and threat model demonstrate it.

## Terminology

- User: person who owns or controls an account.
- Tenant: organization/workspace isolation and billing boundary.
- Developer: person or organization integrating AgentLogin into an agent system.
- Agent: authenticated software identity acting for a user.
- Connected account: website, OAuth, API, or service identity registered with AgentLogin.
- Credential: password, API key, OAuth token, cookie, certificate, or other authentication material.
- Grant: short-lived, scoped authorization to perform defined operations. Not a credential.
- Execution: operation performed by an AgentLogin-controlled connector or isolated browser session.
- Origin: normalized scheme, host, and effective port. Never authorize by loose substring or display-name matching.
- Policy: server-enforced rules governing agent actions and approval requirements.

## Expected architecture

Keep components modular; do not hard-code unconfirmed infrastructure choices.

1. **Agent/developer integration:** TypeScript SDK, REST API, MCP interface, authenticated agent identity, task context. Returns grants and permitted results only.
2. **API/security gateway:** developer and tenant auth, agent identity, user delegation, authorization, policy evaluation, approvals, grant issuance/revocation, rate limits, audit.
3. **Credential vault:** encrypted credential/token storage, envelope encryption, tenant isolation, versioning, rotation, deletion lifecycle.
4. **Execution layer:** isolated browser workers for website login; provider-specific OAuth/API connectors; credential retrieval only inside trusted execution; output sanitization.
5. **User control plane:** secure enrollment, connected accounts, agent/account permissions, approvals, revocation, audit history.

Cloud, database, KMS, browser vendor, and hosting choices are not finalized. Keep them behind interfaces and record decisions in plans.md.

## Website login flow

1. User authenticates to AgentLogin and connects a website account through a trusted enrollment flow.
2. AgentLogin validates and stores credentials securely. Credentials never pass through an agent conversation or agent tool call.
3. Agent authenticates to AgentLogin and requests a login capability for a specific connected account and exact origin.
4. Policy engine checks tenant, user delegation, agent, account ownership, origin, scope, risk, expiry, and approval requirements.
5. If approved, AgentLogin returns the opaque grant object.
6. Agent invokes a grant-bound operation. AgentLogin validates grant and executes login inside an isolated browser worker.
7. Worker retrieves credentials only inside the trusted boundary, validates destination origin, and fills the login form.
8. MFA, CAPTCHA, suspicious login challenges, and user-presence requirements pause for secure user interaction. Never bypass them.
9. Agent receives only permitted outcome and sanitized data. It never receives password, cookies, storage, auth headers, raw network traces, browser profile, or unrestricted debugging access.
10. AgentLogin writes a secret-free audit event and enforces expiry/revocation.

Successful login does not imply permission to perform every action on the website. Login and post-login actions require separately scoped permissions.

## Grant and execution semantics

- Generate high-entropy, unguessable grant IDs. Treat them as sensitive references, but not as credentials.
- Bind each grant server-side to tenant, user, authenticated agent, connected account, exact origin, scopes, issued-at, expiry, policy version, approval, and execution/task context.
- Persist authoritative grant state server-side. Never trust client-supplied scope, origin, expiry, user ID, or approval state.
- Enforce expiry and revocation on every operation.
- A grant cannot be widened, transferred to another agent, reused for another account, or replayed against another origin.
- Use idempotency keys where retries could duplicate actions.
- Approval and execution are distinct: status approved means authorization was granted, not that login succeeded.
- Return stable non-secret errors: grant_expired, grant_revoked, origin_mismatch, scope_denied, approval_required, mfa_required, login_failed.
- Use conservative default TTL and hard maximum; make both policy-configurable.

Initial public grant type:

~~~ts
type AgentLoginGrant = {
  status: "approved";
  grant_id: string;
  origin: string;
  expires_at: string; // ISO 8601 UTC
  scopes: string[];
};
~~~

Initial website-login scope: autofill_login. Define future scopes narrowly; do not introduce broad browser_access or full_access.

## Credential and cryptography requirements

- Prefer envelope encryption: cryptographically secure DEK per credential/isolated record; authenticated encryption such as AES-256-GCM; wrap DEK with KMS-managed key.
- Bind ciphertext to tenant ID, credential ID, record version, and purpose using authenticated associated data.
- Store ciphertext, wrapped DEK, key version, and non-secret metadata separately from app configuration.
- Never store plaintext credentials in logs, analytics, traces, error reports, metrics, queues, job payloads, browser URLs, or ordinary database columns.
- Restrict decrypt permissions to the smallest execution service identity. General API and agent-facing services must not have broad plaintext access.
- Minimize plaintext lifetime; clear temporary buffers where runtime permits.
- Support credential update, rotation, revocation, and secure deletion.
- Use TLS and encryption at rest, but do not present either as a complete vault design.
- KMS does not protect against compromised application code that has decrypt permission. Document this residual risk.
- Keep key custody provider-neutral; managed KMS can be initial, with BYOK/customer-managed keys evaluated later.

## Browser execution security

- Isolate browser process/context, profile, cookies, storage, downloads, and temporary files by user/session.
- Never expose CDP, DevTools, remote debugging, profile directories, cookies, storage, raw headers, or unrestricted network inspection to agents.
- Redact/suppress passwords, one-time codes, tokens, and sensitive fields from screenshots, DOM snapshots, accessibility trees, page text, and returned artifacts.
- Validate final destination and every redirect against the grant origin before injecting credentials. Never autofill on an unexpected origin, lookalike domain, or untrusted cross-origin frame.
- Do not let page content or prompt injection alter AgentLogin policy or request credential disclosure.
- Prevent cross-session downloads, clipboard leakage, filesystem access, extension leakage, and shared profile reuse.
- Defend against SSRF, DNS rebinding, private-network access, and cloud metadata endpoints.
- MFA and CAPTCHA are user challenges, not obstacles to circumvent. Provide secure user handoff/resume.
- Keep browser provider adapters replaceable. Provider claims do not replace our own threat model and tests.

## OAuth and API credential security

- Use OAuth Authorization Code + PKCE where supported.
- Request minimal scopes and explain them to users.
- Protect refresh tokens; rotate and detect reuse where supported; revoke on disconnect.
- Never return access or refresh tokens to agents. Execute provider API calls inside AgentLogin connectors and return permitted data only.
- Prefer short-lived credentials/token exchange over permanent API keys where supported.
- Validate OAuth state, issuer, audience, redirect URI, and nonce where applicable.
- Treat provider responses as untrusted input and sanitize results.

## Authorization and policy

Evaluate tenant, user, authenticated agent, connected account, exact origin/provider, requested scope/action, risk, user policy, approval, expiry/revocation, and rate limits.

Default posture:
- login/autofill: allowed only under explicit user delegation and scope;
- read/search: allowed only when granted;
- draft/create: configurable, may require approval;
- send/publish/purchase/transfer: approval required by default;
- delete, recovery-setting changes, adding authentication factors, ownership changes: deny by default until a high-assurance policy exists.

Never silently promote a login grant into a general action grant.

## Audit, privacy, observability

Audit events should include event ID, tenant, user, agent, connected-account reference, origin/provider, requested scope, policy decision, approval reference, grant/execution reference, timestamps, result category, and safe correlation IDs.

Never log passwords, tokens, cookies, auth headers, recovery codes, private keys, decrypted payloads, or raw secret-bearing browser traces. Use structured logs, secret scrubbing, access controls, retention limits, and tamper-resistant audit storage.

## Engineering workflow for coding agents

Before changing code:
1. Inspect repository structure, implementation, manifests, tests, and docs.
2. Read AGENT.md and plans.md.
3. Identify the relevant milestone and acceptance criteria.
4. Follow established conventions where safe.
5. For security-sensitive work, state the threat and trust boundary affected.

While implementing:
- Make small, reviewable changes with tests.
- Keep public contracts typed, documented, and versioned.
- Validate untrusted input at boundaries.
- Perform explicit server-side authorization; never rely on UI state.
- Keep secrets out of return values, exceptions, snapshots, fixtures, and logs.
- Add negative tests for denied, expired, revoked, wrong-origin, wrong-agent, wrong-tenant, and insufficient-scope cases.
- Add replay and concurrency tests for grants/executions.
- Never weaken security to make a test pass.
- Do not claim an integration works without a tested implementation.
- Do not add a Chusky dependency or use its browser.

Before marking work complete:
1. Run relevant unit, integration, type, lint, and security tests available.
2. Review diffs for secrets, unsafe logging, broad scopes, missing tenant checks, and credential exposure.
3. Verify agent-facing responses contain no credential material.
4. Update plans.md with actual status and evidence; do not mark unimplemented work done.
5. Report changes, tests, failures, and remaining risks honestly.

## Definition of done for credential features

Tests must demonstrate:
- agent cannot retrieve credentials through API, SDK, MCP, browser tools, logs, traces, errors, screenshots, or artifacts;
- authorization binds correct tenant, user, agent, account, origin, and scope;
- expired/revoked grants are rejected;
- wrong-origin and redirect cases never receive credentials;
- MFA/CAPTCHA pauses for user action;
- secrets are not logged or emitted to telemetry;
- audit events contain no secret values;
- failure paths fail closed.

## Documentation discipline

- AGENT.md: durable coding-agent instructions and product/security invariants.
- plans.md: living roadmap, milestone status, acceptance criteria, and open decisions.
- Record significant architectural choices and rationale.
- Do not turn provisional suggestions into settled decisions without evidence or explicit approval.
- Prefer precise language over marketing claims.

## Current identity and credential lifecycle implementation

The current API implementation uses two separate authentication paths:

- **Agent authentication:** `Authorization: Bearer al_agent_...` with an HMAC-signed tenant claim. Verify the signature before constructing a tenant-scoped repository. The database stores only a SHA-256 hash of the random token secret. Never accept tenant ID from an unsigned header or body.
- **User authentication:** OIDC access token verified against configured issuer, audience, HTTPS JWKS URL, allowed asymmetric algorithms, expiry/token age, and a trusted tenant claim. Required settings are `OIDC_ISSUER_URL`, `OIDC_AUDIENCE`, `OIDC_JWKS_URL`, and `OIDC_TENANT_CLAIM`. Do not accept a caller-supplied tenant ID.

The `AGENT_TOKEN_SIGNING_KEY` must be a stable, cryptographically random 256-bit secret encoded as canonical base64url. Do not rotate it in place. Implement a key-ID/key-ring migration before supporting overlapping keys. Existing unsigned-format agent credentials are not compatible with the signed format and must be rotated/re-issued.

Authenticated developer owners/admins may create agents, rotate credentials, and revoke credentials. Agent credential tokens are displayed once and only their hashes are persisted. Rotation revokes prior active credentials atomically with insertion of the replacement.

Grant requests require a matching active user-to-agent-to-account delegation. The initial policy is deliberately conservative: every grant request enters pending approval. Approval is a separate user action. Grant authorization binds tenant, user, agent, account, exact origin, scope, policy version, expiry, approval, and revocation.

Credential encryption context must bind tenant, account, credential ID, record version, and purpose. Production KMS must be configured with a dedicated key and least-privilege workload identity. Never substitute the synthetic test KMS in production.

The execution coordinator is not a browser implementation. Do not expose login execution until a concrete isolated worker has been implemented and adversarially tested. A worker must enforce exact origin and every redirect before autofill, block private-network/metadata targets, isolate profiles and sessions, keep CDP/debugging inaccessible, sanitize all outputs, and implement user-mediated MFA handoff.

### Local/production configuration

See `.env.example`. Do not commit production values. Railway currently needs an OIDC provider configuration and AWS KMS key/identity before user onboarding or real credential storage can work. Treat missing configuration as unavailable and fail closed.
