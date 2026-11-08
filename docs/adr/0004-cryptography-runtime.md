# ADR 0004: Cryptography runtime and API guidance

- Date: 2026-11-08
- Status: Accepted as implementation guidance; no cryptography implemented

## Context

The repository's runtime scaffold is Node.js 22 with Fastify. Cloudflare Workers remains unselected. The vault package currently declares types and interfaces only; it contains no key generation, encryption, decryption, key import, KMS calls, or secret storage implementation.

Official documentation was reviewed for Cloudflare Workers Web Crypto and Node.js v24 crypto APIs. The repository's current Node 22 pin is not changed by this documentation review; a runtime upgrade requires its own dependency and CI verification.

## Decision

- Do not implement custom cryptographic algorithms, modes, key derivation, random-number generators, or key-wrapping formats.
- Use a well-reviewed platform API or established cryptographic library with a documented, interoperable format. The exact implementation and library require a separate review.
- Prefer the standard Web Crypto API when a future component genuinely needs the same crypto surface in Node.js and Workers. For a Node-only service, Node's node:crypto APIs are also appropriate. Do not assume every Node package or KMS SDK works in Workers merely because nodejs_compat is enabled.
- Use authenticated encryption for credential records and authenticate the record context. The selected format must carry and validate the algorithm/version, nonce/IV, ciphertext, authentication tag, wrapped DEK, and AAD version.
- Generate keys and nonces only with a cryptographically secure platform random source. Enforce the selected algorithm's nonce-uniqueness requirements and reject malformed/truncated envelopes. These details must be implemented from the chosen API's official specification and reviewed test vectors, not handwritten from memory.
- Import a DEK into a non-extractable runtime key object where the selected workflow permits it. If the KMS returns a plaintext DEK for local encryption, the trusted process still handles that DEK briefly; non-extractability does not eliminate that plaintext-memory exposure.
- Keep the KEK in KMS/HSM. Web Crypto or Node crypto performs local data encryption; neither replaces key custody, workload identity, KMS policy, key rotation, or audit.
- Do not expose a decrypt/unwrap operation to the API or MCP boundary. Decryption belongs only in the narrowly authorized enrollment or execution process after fresh grant validation.

## Runtime-specific evidence

Cloudflare Workers documents crypto.subtle operations including generateKey, importKey, and wrapKey. Its runtime also documents a subset of Node.js APIs and compatibility shims; unsupported shimmed methods may throw. Workers Web Crypto is therefore a viable primitive surface, not evidence that a Node KMS SDK or the existing Fastify server can be moved without compatibility testing.

Node.js v24 documentation exposes the Web Crypto implementation through crypto.webcrypto and documents Node-specific key APIs such as KeyObject and createSecretKey. The current repository is pinned to Node 22, so implementation must be tested against the actual supported runtime matrix rather than assuming the v24 documentation alone proves Node 22 behavior.

## Consequences

- No crypto code, test vectors, KMS adapter, or credential-acceptance endpoint is added by this ADR.
- The vault interfaces remain placeholders and must not be treated as production capability.
- A future crypto implementation needs synthetic-only tests for tampering, wrong AAD, wrong tenant/credential/version/purpose, nonce misuse prevention, rotation, key-version mismatch, and failure paths.
- A security review must confirm that plaintext never appears in API/MCP responses, logs, traces, screenshots, error reports, or artifacts.

## References

- [Cloudflare Workers Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/)
- [Cloudflare Workers Node.js compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/)
- [Node.js v24 crypto API](https://nodejs.org/docs/latest-v24.x/api/crypto.html)
- [Node.js v24 Web Crypto API](https://nodejs.org/docs/latest-v24.x/api/webcrypto.html)
