import {
  DecryptCommand,
  EncryptCommand,
  GenerateDataKeyCommand,
  GenerateDataKeyWithoutPlaintextCommand,
  KMSClient
} from "@aws-sdk/client-kms";
import { execFileSync } from "node:child_process";

const region = process.env.AWS_REGION;
const keyId = process.env.AWS_KMS_KEY_ID;
const expectedAccount = process.env.AWS_EXPECTED_ACCOUNT_ID;

if (!region || !keyId) {
  console.error("FAIL: AWS_REGION and AWS_KMS_KEY_ID must be set.");
  process.exit(1);
}

const kms = new KMSClient({ region });
const encryptionContext = { purpose: "website_login" };
let failures = 0;
let skipped = 0;

function report(name, passed, detail) {
  console.log(`${passed ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
  if (!passed) failures += 1;
}

async function expectDenied(name, command) {
  try {
    await kms.send(command);
    report(name, false, "AWS allowed an operation that must be denied");
  } catch (error) {
    if (error?.name === "AccessDeniedException" || error?.name === "AccessDenied") {
      report(name, true, "AccessDenied returned as expected");
    } else {
      report(name, false, `Expected AccessDenied; received ${error?.name ?? "unknown error"}`);
    }
  }
}

async function main() {
  console.log("AgentLogin isolated-worker KMS permission check");
  console.log(`Region: ${region}`);
  console.log(`Key: ${keyId}`);
  console.log("No secrets or credential values will be printed.\n");

  // Optional identity check when AWS CLI is installed locally.
  try {
    const raw = execFileSync("aws", ["sts", "get-caller-identity", "--output", "json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    const identity = JSON.parse(raw);
    console.log(`AWS caller: ${identity.Arn}`);
    console.log(`AWS account: ${identity.Account}`);
    if (expectedAccount) {
      report("AWS account matches AWS_EXPECTED_ACCOUNT_ID", identity.Account === expectedAccount);
    }
  } catch {
    skipped += 1;
    console.log("SKIP: AWS CLI unavailable; caller identity not independently displayed.");
  }

  // KMS authorizes the request before it can validate/decrypt the ciphertext.
  // Invalid synthetic bytes let us test the IAM action without storing or
  // handling any real encrypted credential material.
  try {
    await kms.send(new DecryptCommand({
      KeyId: keyId,
      CiphertextBlob: Buffer.from("agentlogin-permission-probe-not-ciphertext"),
      EncryptionContext: encryptionContext
    }));
    report("kms:Decrypt authorization", false, "Unexpectedly accepted invalid ciphertext");
  } catch (error) {
    if (error?.name === "InvalidCiphertextException") {
      report("kms:Decrypt authorization", true, "KMS reached ciphertext validation; decrypt is authorized");
    } else if (error?.name === "AccessDeniedException" || error?.name === "AccessDenied") {
      report("kms:Decrypt authorization", false, "Worker is not authorized to decrypt");
    } else {
      report("kms:Decrypt authorization", false, `Unexpected AWS response: ${error?.name ?? "unknown"}`);
    }
  }

  // A policy conditioned on purpose=website_login must reject a different
  // encryption context before ciphertext validation.
  try {
    await kms.send(new DecryptCommand({
      KeyId: keyId,
      CiphertextBlob: Buffer.from("agentlogin-permission-probe-not-ciphertext"),
      EncryptionContext: { purpose: "wrong_context_probe" }
    }));
    report("KMS encryption-context restriction", false, "Wrong purpose was accepted");
  } catch (error) {
    if (error?.name === "AccessDeniedException" || error?.name === "AccessDenied") {
      report("KMS encryption-context restriction", true, "Wrong purpose denied");
    } else if (error?.name === "InvalidCiphertextException") {
      report("KMS encryption-context restriction", false, "Wrong purpose reached ciphertext validation; context condition is not enforced");
    } else {
      report("KMS encryption-context restriction", false, `Unexpected AWS response: ${error?.name ?? "unknown"}`);
    }
  }

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
      console.log("Note: caller identity display was skipped; install AWS CLI to include it.");
    }
    console.log("Note: Decrypt authorization is checked using invalid synthetic ciphertext; this does not prove a real ciphertext can be decrypted.");
  }
}

main().catch((error) => {
  console.error(`Diagnostic failed: ${error?.name ?? "UnknownError"}`);
  process.exitCode = 1;
});
