# ADR 0002: Cloudflare Workers placement

- Date: 2026-11-08
- Status: Accepted for the current architecture baseline; no Cloudflare deployment selected

## Context

The current scaffold is a TypeScript pnpm workspace with a Node.js/Fastify 5 API, a Next.js web control-plane shell, an MCP boundary, provider-neutral vault/execution interfaces, and a PostgreSQL schema plus local Docker Compose service. The inspected branch contains no Wrangler configuration, Worker entry point, Cloudflare bindings, Hyperdrive configuration, or Cloudflare SDK dependency.

The security boundary requires fresh server-side authorization for every operation, authoritative tenant/grant/approval state, and credential decryption only inside a narrowly trusted enrollment or execution process. A Worker placed in front of the API must not become a second, weaker authorization system.

## Decision

1. Keep the Node.js/Fastify API as the primary control plane and authorization enforcement point for the current milestone.
2. Keep PostgreSQL as the proposed authoritative relational store for users, tenants, delegations, grants, approvals, executions, and audit metadata. The current migration is only a schema foundation; no persistence adapter or production database is implemented.
3. Do not select Cloudflare Workers for the core API, credential vault, key custody, or browser execution at this stage.
4. Consider a Cloudflare Worker only as an optional edge ingress/WAF/routing layer if measured requirements justify it. It must forward to the Node API over an authenticated channel; it must not mint or widen grants independently, receive credential plaintext, or hold KMS decrypt authority.
5. Do not add D1, KV, R2, or Durable Objects to the current architecture:
   - D1 would introduce a second relational data model while PostgreSQL is already the scaffold's database direction.
   - KV is not the authoritative source for revocation, approval, or grant policy decisions.
   - R2 may be considered later for larger encrypted artifacts, but the current credential metadata model does not justify it.
   - Durable Objects may be useful for a later coordination/idempotency problem, but no such requirement is implemented or measured.
   - Hyperdrive is a PostgreSQL connectivity/connection-management option for Workers, not a database, KMS, or authorization system.
6. Do not treat a Workers isolate as a browser sandbox. Website login requires a separately selected execution provider with explicit process/context, profile, filesystem, network-egress, and cleanup isolation.

## Evidence and rationale

Cloudflare documents a Workers runtime with a subset of Node.js APIs. Some APIs are implemented by the runtime while others are shimmed by Wrangler and may throw when invoked. The nodejs_compat flag therefore does not make Workers equivalent to a full Node.js process. Cloudflare does document a PostgreSQL pg + Hyperdrive pattern, so PostgreSQL connectivity is possible, but it adds a second runtime and binding/configuration surface without solving the current product's main security problem.

Workers isolates provide lightweight runtime isolation for Worker code. That property is not evidence of per-user browser-profile isolation, a general-purpose browser environment, or a separate security principal for every request handled by one Worker deployment. Browser execution must be evaluated independently.

Cloudflare bindings expose configured platform resources and secrets to Worker code. A secret binding is deployment configuration, not a per-credential envelope-encryption service or a substitute for a KMS policy. The Workers Web Crypto API supplies standard cryptographic primitives; it does not itself establish key custody, tenant authorization, or an external KMS integration.

## Consequences

- The current Node/Fastify control plane remains the single place that authenticates the agent and resolves the authoritative grant, approval, policy version, and execution context.
- API and MCP processes must not decrypt credentials.
- The execution provider remains an open choice and must be isolated independently of the HTTP runtime.
- Cloudflare can be reconsidered after edge security, geography, latency, service-authentication, and operational requirements are measured.
- No Cloudflare integration is implemented by this ADR.

## Open questions

- Is edge WAF/rate limiting/traffic steering required beyond the selected host's controls?
- Where will the Node API and isolated execution service run, and what workload identity will each use?
- If a Worker is later adopted, how will it authenticate to the API, and which request metadata may safely cross the edge boundary?
- What region, data-residency, logging, and incident-response constraints apply?

## References

- [Cloudflare Workers runtime and Node.js compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/)
- [Cloudflare Workers isolates and runtime model](https://developers.cloudflare.com/workers/llms-full.txt)
- [Cloudflare Workers bindings](https://developers.cloudflare.com/workers/configuration/bindings/)
- [Cloudflare Hyperdrive](https://developers.cloudflare.com/hyperdrive/)
- [Cloudflare Workers Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/)
