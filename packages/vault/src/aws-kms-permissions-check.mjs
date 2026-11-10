import {
  DecryptCommand,
  EncryptCommand,
  GenerateDataKeyCommand,
  GenerateDataKeyWithoutPlaintextCommand,
  KMSClient
} from "@aws-sdk/client-kms";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";

const region = process.env.AWS_REGION;
const keyId = process.env.AWS_KMS_KEY_ID;
const expectedAccount = process.env.AWS_EXPECTED_ACCOUNT_ID;
const fixtureBase64 = process.env.AWS_KMS_TEST_CIPHERTEXT_B64;
const expectedFixturePlaintext =
  process.env.AWS_KMS_TEST_PLAINTEXT ?? "agentlogin-kms-policy-probe-v1";

if (!region || !keyId) {
  console.error("FAIL: AWS_REGION and AWS_KMS_KEY_ID must be set.");
  process.exit(1);
}

const kms = new KMSClient({ region });
const sts = new STSClient({ region });
const encryptionContext = { purpose: "website_login" };
let failures = 0;
let skipped = 0;

function report(name, passed, detail) {
  console.log(`${passed ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
  if (!passed) failures += 1;
}

function skip(name, detail) {
  console.log(`SKIP: ${name} — ${detail}`);
  skipped += 1;
}

function isAccessDenied(error) {
  return error?.name === "AccessDeniedException" || error?.name === "AccessDenied";
}

async function expectDenied(name, command) {
  try {
    await kms.send(command);
    report(name, false, "AWS allowed an operation that must be denied");
  } catch (error) {
    if (isAccessDenied(error)) {
      report(name, true, "AccessDenied returned as expected");
    } else {
      report(name, false, `Expected AccessDenied; received ${error?.name ?? "unknown error"}`);
    }
  }
}

async function checkDecryptPolicy() {
  if (!fixtureBase64) {
    skip(
      "KMS decrypt authorization and encryption-context restriction",
      "set AWS_KMS_TEST_CIPHERTEXT_B64 to a synthetic ciphertext encrypted with this key and purpose=website_login; malformed ciphertext cannot prove Decrypt authorization"
    );
    return;
  }

  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(fixtureBase64)) {
    report("KMS decrypt test fixture", false, "AWS_KMS_TEST_CIPHERTEXT_B64 is not valid base64");
    return;
  }

  const ciphertext = Buffer.from(fixtureBase64, "base64");
  if (!ciphertext.length) {
    report("KMS decrypt test fixture", false, "AWS_KMS_TEST_CIPHERTEXT_B64 decoded to an empty value");
    return;
  }

  // This must be a harmless test marker encrypted by an administrator or
  // another principal allowed to call kms:Encrypt. The worker itself is
  // intentionally denied kms:Encrypt.
  try {
    const result = await kms.send(new DecryptCommand({
      KeyId: keyId,
      CiphertextBlob: ciphertext,
      EncryptionContext: encryptionContext
    }));
    const plaintext = Buffer.from(result.Plaintext ?? []).toString("utf8");
    report(
      "kms:Decrypt authorization with allowed context",
      plaintext === expectedFixturePlaintext,
      plaintext === expectedFixturePlaintext
        ? "Synthetic fixture decrypted and matched the expected marker"
        : "Decrypt succeeded, but plaintext did not match AWS_KMS_TEST_PLAINTEXT"
    );
  } catch (error) {
    report(
      "kms:Decrypt authorization with allowed context",
      false,
      `Expected the valid fixture to decrypt; received ${error?.name ?? "unknown error"}`
    );
    // A bad fixture makes the wrong-context result uninterpretable.
    return;
  }

  // Reuse the same valid ciphertext but deliberately change its context.
  // AccessDenied proves the IAM explicit deny was applied. InvalidCiphertext
  // means the request reached cryptographic validation, so the policy deny
  // was not observed before that stage.
  try {
    await kms.send(new DecryptCommand({
      KeyId: keyId,
      CiphertextBlob: ciphertext,
      EncryptionContext: { purpose: "wrong_context_probe" }
    }));
    report("KMS encryption-context restriction", false, "Wrong purpose was accepted");
  } catch (error) {
    if (isAccessDenied(error)) {
      report("KMS encryption-context restriction", true, "Wrong purpose denied before ciphertext validation");
    } else if (error?.name === "InvalidCiphertextException") {
      report(
        "KMS encryption-context restriction",
        false,
        "Wrong purpose reached cryptographic validation; the explicit deny was not observed"
      );
    } else {
      report(
        "KMS encryption-context restriction",
        false,
        `Expected AccessDenied; received ${error?.name ?? "unknown error"}`
      );
    }
  }
}

async function main() {
  console.log("AgentLogin isolated-worker KMS permission check");
  console.log(`Region: ${region}`);
  console.log(`Key: ${keyId}`);
  console.log("No secrets or credential values will be printed.\n");

  // STS GetCallerIdentity works with the same SDK credential provider chain
  // used by KMS and does not require an AWS CLI installation.
  try {
    const identity = await sts.send(new GetCallerIdentityCommand({}));
    console.log(`AWS caller: ${identity.Arn}`);
    console.log(`AWS account: ${identity.Account}`);
    if (expectedAccount) {
      report("AWS account matches AWS_EXPECTED_ACCOUNT_ID", identity.Account === expectedAccount);
    }
  } catch (error) {
    skipped += 1;
    console.log(`SKIP: AWS caller identity unavailable (${error?.name ?? "unknown error"}).`);
  }

  await checkDecryptPolicy();

  await expectDenied("kms:Encrypt is denied", new EncryptCommand({
    KeyId: keyId,
    Plaintext: Buffer.from("agentlogin-worker-permission-probe"),
    EncryptionContext: encryptionContext
  }));

  await expectDenied("kms:GenerateDataKey is denied", new GenerateDataKeyCommand({
    KeyId: keyId,
    KeySpec: "AES_256",
    EncryptionContext: encryptionContext
  }));

  await expectDenied(
    "kms:GenerateDataKeyWithoutPlaintext is denied",
    new GenerateDataKeyWithoutPlaintextCommand({
      KeyId: keyId,
      KeySpec: "AES_256",
      EncryptionContext: encryptionContext
    })
  );

  console.log("\nSummary");
  console.log(`Failures: ${failures}`);
  console.log(`Skipped: ${skipped}`);
  if (failures > 0) {
    console.error("KMS permission gate NOT PASSED.");
    process.exitCode = 1;
  } else {
    console.log("KMS permission-action checks passed.");
    if (skipped) {
      console.log("Note: Decrypt authorization and context enforcement remain unverified until a valid synthetic ciphertext fixture is supplied.");
    }
  }
}

main().catch((error) => {
  console.error(`Diagnostic failed: ${error?.name ?? "UnknownError"}`);
  process.exitCode = 1;
});
