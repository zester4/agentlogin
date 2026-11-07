# ADR 0001: Initial repository scaffold

- Status: Accepted for scaffold only
- Date: 2026-11-07

## Decision
Use a TypeScript pnpm workspace with separate API, web control-plane, MCP adapter, contracts, policy, SDK, vault and execution packages. PostgreSQL is the local development relational model. Production database, KMS, hosting and browser vendor decisions remain open.

## Rationale
The product requires clear trust boundaries and independently testable modules. This is a starting point, not a commitment to a production provider.

## Consequences
Shared contracts are centralized. Vault decryption and browser execution remain interfaces until secure providers are selected and reviewed. API readiness remains false until real persistence and security dependencies are configured. No production secret-handling capability is implied.
