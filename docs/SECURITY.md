# Security model and release gates

Assets include credential plaintext, OAuth tokens, cookies, sessions, recovery codes, signing keys, user/tenant data, grants, approvals and audit records. Threat actors include malicious agents/developers, hostile sites and prompt injection, cross-tenant attackers, stolen developer/agent credentials, compromised workers, insiders and supply-chain compromise.

## Implemented identity controls

- User access tokens are verified against a configured public RSA JWKS using RS256 only, with exact issuer/audience, expiry, not-before, issued-at, subject and signed tenant claim validation. User/tenant membership and active status are checked in PostgreSQL.
- Developer API keys and agent credentials are generated from 256 bits of cryptographic randomness. Only SHA-256 hashes are stored; raw values are not persisted.
- Developer credentials bind tenant + developer. Agent credentials bind tenant + developer + agent, with composite foreign keys and status checks.
- Credentials have explicit scopes, a 30-day default lifetime, a 90-day hard maximum, revocation and rotation. Rotation is transactional and revokes the old credential.
- Each tenant-scoped SQL operation sets a transaction-local tenant context, uses explicit tenant/owner predicates, and is protected by forced PostgreSQL RLS policies.
- API logging redacts authorization, cookies and credential-like fields. Provisioning responses use no-store headers. Identity inspection endpoints return safe metadata only.
- Strict request schemas reject caller-supplied tenant IDs. Tenant and actor principals are derived from verified user tokens or successfully verified credential hashes and their database records.
- Identity authentication, provisioning and operator bootstrap routes remain disabled unless startup readiness confirms the identity migration, forced RLS policies and a non-superuser/non-`BYPASSRLS` runtime database role.

The current OIDC adapter uses a static JWKS supplied through environment configuration. It is a bounded generic adapter, not a selected identity-provider integration. Key rotation requires an operator to update the configured public JWKS and redeploy. Tenant bootstrap is operator-controlled through a separate bootstrap secret; public self-service signup and invitation flows are not implemented.

## Credential handling rules

A provisioning endpoint returns a raw developer/agent credential once to the authenticated operator/developer that requested it. This is a secret-bearing control-plane response, not an agent capability. Store it only in a trusted developer backend or secret manager. Never forward it to an LLM, prompt, agent-visible tool output, logs, analytics, screenshots, traces or support transcripts. If an LLM agent needs to call AgentLogin, its trusted runtime must hold the credential and proxy the request.

The tenant/developer/agent identifiers embedded in a credential are not trusted authorization claims. They only narrow the lookup. AgentLogin verifies the one-way hash and current database state before creating a principal. Possession of a credential ID or grant ID alone is insufficient.

## Database requirements

- All tenant-owned tables use forced RLS with a transaction-local `app.tenant_id`.
- Repository queries must also include explicit `tenant_id` and ownership predicates.
- Composite foreign keys bind agent credentials to the exact tenant, developer and agent.
- Runtime database roles must not be superusers and must not have `BYPASSRLS`. Local Compose provisions a separate `agentlogin_app` role; migrations use `MIGRATION_DATABASE_URL` and the API uses `DATABASE_URL`.
- RLS does not protect against compromised application code that deliberately sets another tenant context; retain explicit authorization checks and database least privilege.

## Remaining mandatory controls

Identity is only one trust boundary. Before production credentials are accepted, AgentLogin still requires exact canonical-origin short-lived grants; per-operation validation of tenant, user, authenticated agent, connected account, scope, current policy version, approval reference/current decision, task/execution-context ID, operation, expiry and revocation; approval for sensitive writes; envelope encryption with authenticated context binding; decryption only in isolated workers after fresh authorization; egress controls against loopback/private/link-local/metadata destinations; redirect/frame checks before injection; redaction across DOM/screenshots/logs/traces/errors; rate limits/replay/idempotency controls; secret-free tamper-evident audit; incident response, key rotation, deletion and restore procedures.

Never bypass MFA, CAPTCHA, bot defenses or user-presence checks. Never export profiles, cookies, tokens or passwords to agents. Never claim zero knowledge based on encryption at rest or KMS alone.

The vault has no encryption/decryption implementation, the grants and approvals are not wired to routes or persistence operations, and browser execution is not implemented. Do not accept production credentials until identity, database isolation, vault/KMS, grants, browser isolation, audit controls and adversarial tests are implemented and independently reviewed. Scaffold and passing CI do not establish production security.
