# Architecture

## Trust boundaries
1. Control plane: user authentication, connected accounts, delegation, approvals, audit and revocation.
2. Agent API: authenticates agent workload identity and exposes task-level operations only.
3. Authorization: evaluates tenant, user, agent, account, exact origin, scope, policy, approval, expiry and revocation for every operation.
4. Vault: encrypted storage and callback-scoped decryption for approved execution identities only.
5. Execution workers: isolated website login and provider connectors; no shared profiles or secret-bearing artifacts with agents.
6. Adapters: provider-neutral KMS, database, browser, OAuth, notification and storage interfaces.

## Flow
```text
Agent -> authenticated API -> grant request -> policy/delegation -> user approval
Agent -> login operation -> fresh grant validation -> isolated worker -> vault + target site
Agent <- allowlisted sanitized result <- execution/audit
```

Tenant context must come from verified authentication, never request body fields. Grant IDs are not bearer authorization. Origin checks use parsed normalized scheme/host/effective port and exact equality. Decryption is absent from API and MCP processes.


## Runtime and key-custody direction

The current repository scaffold uses a Node.js/Fastify API and PostgreSQL schema foundation. The API is the recommended control-plane runtime for this milestone; PostgreSQL is the proposed authoritative relational store, but no production persistence adapter is implemented. Cloudflare Workers are not selected for the core API, vault, or browser execution. A Worker may be evaluated later as optional edge ingress only, with authorization remaining authoritative in the Node API.

The vault and execution packages are interfaces, not implementations. No KMS provider, encryption implementation, browser provider, or production hosting provider has been selected. Decryption must remain outside API and MCP processes.

See [ADR 0002](./adr/0002-cloudflare-workers-placement.md), [ADR 0003](./adr/0003-key-custody-and-envelope-encryption.md), and [ADR 0004](./adr/0004-cryptography-runtime.md).
