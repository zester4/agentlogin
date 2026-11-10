# @agent-login/contracts

Shared Zod runtime schemas and TypeScript types for AgentLogin API and SDK integrations.

## Install

```bash
npm install @agent-login/contracts
```

Most SDK users should install `@agent-login/sdk`, which depends on this package automatically.

## Exports

The package exports validated schemas and inferred TypeScript types for agent identity, grant requests, grant status, execution results, and supported scopes.

```ts
import {
  AgentIdentitySchema,
  GrantRequestSchema,
  type GrantRequest
} from "@agent-login/contracts";
```

## Compatibility

- Node.js 22+
- ESM package
- Zod 4 runtime dependency

These contracts describe the current AgentLogin API surface. They do not grant access or replace server-side authorization checks.
