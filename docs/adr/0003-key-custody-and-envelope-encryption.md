# ADR 0003: Key custody and envelope encryption

- Date: 2026-11-08
- Status: Proposed; provider selection deliberately deferred

## Context

AgentLogin will hold high-value website passwords, API keys, OAuth tokens, cookies, and other authentication material. The current repository contains only a vault interface and a PostgreSQL schema proposal. It has no encryption implementation, KMS SDK, key identifier configuration beyond an empty environment placeholder, workload identity, or credential-enrollment path.

A key-management provider must not be selected independently of the eventual hosting location, execution-service identity, region, compliance needs, and recovery model.

## Decision and recommended design

Adopt envelope encryption as the design target, but do not implement cryptography or accept real credentials in this milestone.

- Encrypt each credential record/version locally with a fresh, cryptographically random data-encryption key (DEK) using an established authenticated-encryption implementation such as AES-256-GCM.
- Wrap the DEK with a key-encryption key (KEK) held by a managed KMS/HSM or an approved Transit service. Store ciphertext, nonce/IV, authentication tag, wrapped DEK, key reference/version, algorithm version, and non-secret metadata.
- Bind ciphertext using authenticated associated data (AAD) containing at least tenant ID, credential ID, record version, and purpose. Reconstruct the same AAD from authoritative database state at decryption time; never trust caller-supplied AAD.
- Where the KMS supports an encryption context, bind non-secret tenant/credential/version/purpose identifiers there as well. Do not place secrets or sensitive personal data in encryption context: AWS documents that encryption context is not encrypted and is written to CloudTrail.
- Permit unwrap/decrypt only to the smallest trusted enrollment or execution identity. The general API, web control plane, SDK, and MCP adapter receive no KMS decrypt permission.
- Keep plaintext DEKs and credentials inside that trusted process for the shortest practical duration. Do not put plaintext DEKs in the database, queues, job payloads, traces, logs, or agent-facing responses.
- Record key version and support rewrapping/rotation, revocation, deletion, backup, and restore procedures before production use.
- Preserve a provider-neutral adapter, but do not mistake the current wrapKey/unwrapKey interface for a working KMS integration.

## Candidate evaluation

| Candidate | Documented capability relevant to AgentLogin | Trade-offs / checks before selection |
|---|---|---|
| AWS KMS | Symmetric KMS keys support GenerateDataKey; encryption context is cryptographically bound to ciphertext and can constrain IAM/key policies. | Strong fit when execution runs in AWS. Encryption context is visible in CloudTrail and must contain non-secret identifiers. Confirm workload identity, key policy, quotas, region, and operational cost. |
| Google Cloud KMS | Official guidance describes local DEK generation, local AES-256-GCM data encryption, and KMS wrapping of the DEK. It recommends a new DEK per write. | Strong fit when execution runs in Google Cloud. Cloud KMS encrypt/decrypt payload limits make it a KEK service rather than a place to encrypt arbitrary credential blobs. Confirm workload identity, IAM, region, quotas, and recovery. |
| Azure Key Vault / Managed HSM | Key Vault supports key wrap/unwrap operations. Current Microsoft documentation identifies symmetric AES keys in Key Vault Premium as public preview; RSA-based wrapping and Managed HSM options need a separate production-fit review. | Do not base production design on a preview symmetric-key feature. Confirm exact key type, algorithm, tier, region, HSM requirements, managed identity, and availability before selection. |
| HashiCorp Vault Transit | Transit provides cryptographic operations, data-key generation, key versions, and an envelope-encryption workflow. It can return a plaintext DEK to the caller for local data encryption. | Provider-neutral and portable, but self-hosting adds HA, storage, backup, upgrade, unseal/recovery, and operational responsibilities. Plaintext DEK access must be limited to the trusted execution identity. Do not send entire credential plaintext through Transit when local envelope encryption is intended. |

Cloudflare Worker secret bindings are not a KMS candidate for this design. They expose deployment-level configuration to Worker code; they do not provide the per-record DEK/KEK lifecycle, authenticated context binding, customer-level key policy, or audit model required here. Workers can call an external KMS only after a supported workload-authentication and network path is designed and tested; no such integration is assumed.

## Recommendation

Prefer a managed KMS/HSM colocated with the eventual trusted execution service, using workload identity and policy constraints rather than long-lived static KMS credentials. Select AWS KMS, Google Cloud KMS, or Azure Key Vault/Managed HSM only after the hosting provider and required regions are decided. Consider Vault Transit if portability or self-managed custody is a deliberate operational requirement and the team is prepared to own its availability and recovery.

Customer-managed keys/BYOK should be a later milestone. It expands the lifecycle surface (tenant-specific key provisioning, access policy, rotation, suspension, recovery, migration, and deletion) and should not delay a safe initial managed-key design.

## Consequences

- No KMS provider is selected or integrated.
- The vault interface is a placeholder only; its methods, metadata, AAD contract, and provider-specific semantics require review before implementation.
- Encryption at rest or KMS use alone does not make AgentLogin zero-knowledge or prevent a compromised authorized execution process from seeing plaintext.
- A provider decision must include an explicit threat-model review of KMS administrators, application operators, execution-service compromise, backups, and incident response.

## Open questions

- Which cloud will host the API and isolated execution service?
- Which workload identity can call KMS without a long-lived static key?
- Is a separate KMS key required per environment, tenant, or security domain?
- What are the regional residency, HSM, compliance, quota, latency, and cost requirements?
- What are the exact key-version, rewrap, emergency-disable, deletion, backup, and restore procedures?
- When, if ever, should BYOK/customer-managed keys be offered?

## References

- [AWS KMS envelope encryption and GenerateDataKey](https://docs.aws.amazon.com/kms/latest/developerguide/kms-cryptography.html)
- [AWS KMS encryption context](https://docs.aws.amazon.com/kms/latest/developerguide/encrypt_context.html)
- [Google Cloud KMS envelope encryption](https://cloud.google.com/kms/docs/envelope-encryption)
- [Azure Key Vault key types and operations](https://learn.microsoft.com/en-us/azure/key-vault/keys/about-keys-details)
- [HashiCorp Vault Transit](https://developer.hashicorp.com/vault/docs/secrets/transit)
- [HashiCorp Vault Transit envelope encryption](https://docs.hashicorp.com/vault/docs/secrets/transit/envelope-encryption)
