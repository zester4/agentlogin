# AWS KMS permission check fixture

The Decrypt authorization and encryption-context checks require a **valid ciphertext**. The worker identity is intentionally denied `kms:Encrypt`, so create this harmless test fixture with an administrator identity in AWS CloudShell.

1. Open AWS CloudShell in **us-east-1** while signed in with an identity allowed to use `kms:Encrypt` on `alias/agentlogin-vault`.
2. Run:

   ```bash
   printf %s 'agentlogin-kms-policy-probe-v1' > /tmp/agentlogin-kms-policy-probe.txt
   aws kms encrypt \
     --region us-east-1 \
     --key-id alias/agentlogin-vault \
     --plaintext fileb:///tmp/agentlogin-kms-policy-probe.txt \
     --encryption-context purpose=website_login \
     --query CiphertextBlob \
     --output text
   ```

3. Copy the single base64 value printed by the command. Do not put it in Git or share it in chat.
4. Add it to the local, untracked `.env` file:

   ```dotenv
   AWS_KMS_TEST_CIPHERTEXT_B64=<paste-the-base64-value>
   AWS_KMS_TEST_PLAINTEXT=agentlogin-kms-policy-probe-v1
   ```

5. Run from the repository root:

   ```powershell
   pnpm --filter @agentlogin/vault test:aws-kms
   ```

The script decrypts the fixture with the allowed `purpose=website_login` context and checks the plaintext in memory without printing it. It then reuses the same valid ciphertext with `purpose=wrong_context_probe`. The explicit IAM deny must return `AccessDenied`; an `InvalidCiphertextException` means the request reached cryptographic validation instead of being stopped by the policy.

The fixture contains only a fixed, non-sensitive marker. It is not production credential material. The encryption context is also non-secret and is recorded in CloudTrail. Do not use real credentials or personal data for this test.

If the administrator identity cannot encrypt with this key, stop rather than changing the worker's deny policy to create the fixture.
