# AWS KMS setup for Railway

This document configures the existing AgentLogin AWS KMS envelope-encryption adapter for the production Railway API service. It deliberately uses a dedicated IAM service user with programmatic access because the Railway workload does not currently have a verified AWS workload-identity federation path in this deployment.

## Existing implementation

- `packages/vault/src/aws-kms.ts` uses AWS SDK v3 `Encrypt` to wrap a random 256-bit data-encryption key and `Decrypt` to unwrap it.
- It binds each operation to the exact tenant, account, credential, record version, and purpose through the KMS encryption context.
- The adapter stores the immutable KMS key ARN returned by KMS as the key version.
- The API's AWS SDK client uses the standard AWS credential provider chain.

The adapter exists, but it must still be wired into the production credential-vault lifecycle before real credentials are accepted. Provisioning IAM credentials alone does not complete that integration.

## Fixed production key

- Region: `us-east-1`
- Key alias: `alias/agentlogin-vault`
- Key ARN: `arn:aws:kms:us-east-1:471742380391:key/ce73891f-9bca-41ea-b9dc-e4555703b4fd`

Use the key ARN in Railway, not the alias, so runtime configuration points unambiguously at the intended key.

## Least-privilege IAM identity policy

Attach this as an inline policy to the dedicated service identity only. It grants only the two KMS data-plane actions the current adapter calls, on the one AgentLogin key. It does not grant key administration, listing, creation, deletion, rotation configuration, or access to other keys.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "UseOnlyAgentLoginVaultKey",
      "Effect": "Allow",
      "Action": [
        "kms:Encrypt",
        "kms:Decrypt"
      ],
      "Resource": "arn:aws:kms:us-east-1:471742380391:key/ce73891f-9bca-41ea-b9dc-e4555703b4fd",
      "Condition": {
        "StringEquals": {
          "kms:EncryptionContext:purpose": [
            "website_login",
            "oauth_token",
            "api_key"
          ]
        }
      }
    }
  ]
}
```

The key's current default account-delegation key policy permits IAM policies in this account to grant access. Do not replace the key policy with a broader application principal. If the key policy is changed later, preserve an account recovery/admin path and explicitly authorize this service identity.

## IAM identity setup

1. Create a dedicated IAM user named `agentlogin-vault-service`. Do not enable AWS Management Console access.
2. Choose **Attach policies directly** and use **Create policy → JSON** to create the policy above. Name it `AgentLoginVaultKmsUseOnly`.
3. Attach only `AgentLoginVaultKmsUseOnly` to this user. Do not attach `AdministratorAccess`, `PowerUserAccess`, or any broad AWS managed policy.
4. Create one access key for **application running outside AWS**. Do not create a console password.
5. Copy the access key ID and secret access key directly into Railway's service variables. The secret access key is shown only once. Never paste either value into chat, GitHub, tickets, or source code.

If AWS presents a use-case warning about long-lived keys, this is a deliberate initial integration choice because a supported Railway workload identity has not been configured. Restrict the key to this one KMS key, store it only in Railway secrets, monitor its use, and establish a rotation procedure. Prefer short-lived federation when a verified Railway workload-identity option becomes available.

## Railway variables

Set these on the **`agentlogin` API service**, not the frontend service:

| Variable | Value |
|---|---|
| `AWS_REGION` | `us-east-1` |
| `AWS_KMS_KEY_ID` | `arn:aws:kms:us-east-1:471742380391:key/ce73891f-9bca-41ea-b9dc-e4555703b4fd` |
| `AWS_ACCESS_KEY_ID` | Access key ID generated for `agentlogin-vault-service` |
| `AWS_SECRET_ACCESS_KEY` | Secret access key generated for `agentlogin-vault-service` |

Mark the secret access key as a secret in Railway. Do not add AWS credentials to the web service, local source files, or GitHub.

## Verification and release gate

After the runtime adapter is wired into the vault service:

1. Verify the API can wrap a random 32-byte DEK with the configured key.
2. Verify it can unwrap the same DEK only with the exact saved key ARN and matching encryption context.
3. Verify a changed tenant, account, credential, version, or purpose fails closed.
4. Verify an unrelated KMS key is denied.
5. Verify CloudWatch/CloudTrail records show only the expected KMS operations and identity; never log plaintext or credentials.
6. Test key disablement, IAM key revocation, service restart, and recovery procedures.
7. Confirm no plaintext or DEK is persisted or returned to an agent.

Do not accept real user credentials until this integration, durable vault storage, audited decrypt authorization, identity/grant enforcement, secret-safe telemetry, recovery/rotation procedures, and the remaining production security review gates are complete.

## Rotation and incident response

- Create a replacement IAM access key before rotating, update the Railway API service variables, verify a successful deployment and KMS operation, then deactivate and delete the old key.
- If an access key is suspected compromised, deactivate it immediately, remove it from Railway, investigate CloudTrail, and issue a replacement.
- Do not disable or schedule deletion of the KMS key while encrypted credentials depend on it. KMS key deletion can make stored credentials permanently unrecoverable.
- KMS key rotation is separate from IAM access-key rotation. Preserve old key material/key versions for decryption of existing wrapped DEKs.
