# ADR 0002: Core runtime and Cloudflare boundary

- Status: Accepted for the current implementation phase
- Date: 2026-11-07

## Context

The merged scaffold uses Node.js 22, Fastify, PostgreSQL and a pnpm TypeScript workspace. No Cloudflare account binding, Wrangler project, Worker deployment, KMS provider or production storage integration exists in the repository.

AgentLogin handles high-impact secrets. Runtime choices must preserve a narrow decryption boundary and must not be selected merely for convenient edge deployment.

## Decision

1. Keep Node.js 22 and Fastify as the control-plane and authentication runtime for this phase.
2. Do not put vault decryption in a Cloudflare Worker yet. There is no verified deployment boundary or requirement for that change.
3. Cloudflare may later provide DNS, WAF, rate limiting, bot controls or a narrowly scoped internal Worker. Those services do not replace application authorization, tenant isolation, KMS or browser isolation.
4. If a Worker is introduced, private service bindings may be appropriate for Worker-to-Worker calls. Do not expose a public Worker endpoint that accepts raw credentials or returns decrypted material.
5. Use Node.js crypto for the current Node-only envelope primitive. A future Worker implementation must use supported Web Crypto APIs and pass shared cross-runtime test vectors; it must not silently change algorithms or AAD formats.
6. Keep key custody behind the provider interface. No KMS vendor is selected by this ADR.

## Cryptographic envelope

The vault primitive uses AES-256-GCM, a fresh 256-bit DEK and 96-bit IV per credential record version, a 128-bit authentication tag, and deterministic AAD binding the AAD schema version, tenant ID, credential ID, record version and purpose. The DEK is wrapped separately through the key-management provider.

The production KMS adapter, durable credential repository, decrypt-only execution identity, key rotation, audit controls and independent review are not yet implemented. Do not store real credentials.

## Consequences

This is a deliberate non-selection of Cloudflare as the core runtime today, not a rejection of Cloudflare. Revisit when deployment, network boundaries, key custody and execution threat models are concrete.

## Documentation references

- https://developers.cloudflare.com/workers/runtime-apis/bindings/
- https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/
- https://developers.cloudflare.com/workers/runtime-apis/web-crypto/
- https://nodejs.org/docs/latest-v22.x/api/crypto.html
