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
