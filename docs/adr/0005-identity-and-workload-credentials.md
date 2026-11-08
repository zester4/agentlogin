# ADR 0005: User identity and workload credentials

- Status: Accepted for the current identity milestone; provider-neutral adapter, not a production IdP selection
- Date: 2026-11-08

## Context

AgentLogin needs distinct user, developer and agent principals. Tenant and actor context must come from verified authentication, never from request-body tenant identifiers. A developer API key must not become an unrestricted agent identity, and a grant reference must never act as a bearer credential.

The repository already uses Node.js 22, Fastify 5, TypeScript and PostgreSQL. No external identity vendor or workload-identity provider had been selected.

## Decision

1. Verify user OIDC access tokens with a bounded RS256 verifier using a configured public JWKS, exact issuer and audience, expiry/not-before/issued-at/subject checks, and a signed `tenant_id` claim. Confirm active membership in PostgreSQL before constructing a user principal.
2. Use separate random 256-bit developer API keys and per-agent credentials. Store only SHA-256 hashes, explicit scopes, expiry, revocation and last-use metadata.
3. Bind developer credentials to tenant + developer. Bind agent credentials to tenant + developer + agent and enforce ownership with composite foreign keys.
4. Use tenant/developer/agent identifiers inside presented credentials only as lookup selectors. Verify the stored hash and active database state before constructing the principal.
5. Use PostgreSQL forced RLS with transaction-local tenant context plus explicit tenant and owner predicates in every repository query.
6. Return raw credentials only once to the authenticated developer/operator provisioning surface, with no-store headers. Never forward them to an LLM or agent-visible transcript.
7. Keep agent scope limited to `agent:read` until grant and execution services exist.

## Consequences

- No identity vendor is selected. The static JWKS adapter supports a configured OIDC issuer; public-key rotation requires a configuration update and redeploy.
- Tenant bootstrap is operator-controlled with a separate environment secret. Public signup, invitations, SSO discovery and provider-specific account linking remain future work.
- Developer and agent credentials are revocable and rotatable, but are bearer secrets for trusted backend runtimes. They must not be embedded in prompts or exposed to model context.
- RLS is defense in depth, not a defense against a compromised app role that can deliberately set another tenant context. Runtime DB roles must not be superusers or have `BYPASSRLS`.
- No credential decryption, grant issuance, approval UX or browser execution is introduced by this ADR.
