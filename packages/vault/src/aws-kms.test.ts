import { describe, expect, it, vi } from "vitest";
import { DecryptCommand, EncryptCommand, KMSClient } from "@aws-sdk/client-kms";
import { AwsKmsProvider } from "./aws-kms.js";

const context = {
  tenantId: "ten_1", accountId: "acc_1", credentialId: "cred_1", recordVersion: 2,
  purpose: "website_login" as const
};

describe("AwsKmsProvider", () => {
  it("wraps a DEK with tenant-bound encryption context and stores the immutable key ARN", async () => {
    const send = vi.fn().mockResolvedValue({
      CiphertextBlob: Buffer.from("wrapped-key"),
      KeyId: "arn:aws:kms:us-east-1:123456789012:key/abc"
    });
    const provider = new AwsKmsProvider("alias/agentlogin", "us-east-1", { send } as unknown as KMSClient);
    const result = await provider.wrapKey(Buffer.alloc(32, 9), context);
    expect(result.keyVersion).toBe("arn:aws:kms:us-east-1:123456789012:key/abc");
    expect(Buffer.from(result.wrappedDek).toString()).toBe("wrapped-key");
    const command = send.mock.calls[0]![0] as EncryptCommand;
    expect(command.input.EncryptionContext).toEqual({
      tenant_id: "ten_1", account_id: "acc_1", credential_id: "cred_1", record_version: "2", purpose: "website_login"
    });
  });

  it("unwraps only with the exact saved key version and matching context", async () => {
    const send = vi.fn().mockResolvedValue({ Plaintext: Buffer.alloc(32, 4) });
    const provider = new AwsKmsProvider("alias/agentlogin", "us-east-1", { send } as unknown as KMSClient);
    const key = await provider.unwrapKey(Buffer.from("wrapped"), "arn:aws:kms:us-east-1:123456789012:key/abc", context);
    expect(key).toHaveLength(32);
    const command = send.mock.calls[0]![0] as DecryptCommand;
    expect(command.input.KeyId).toBe("arn:aws:kms:us-east-1:123456789012:key/abc");
    expect(command.input.EncryptionContext?.tenant_id).toBe("ten_1");
  });

  it("rejects invalid DEK sizes before calling KMS", async () => {
    const send = vi.fn();
    const provider = new AwsKmsProvider("alias/agentlogin", "us-east-1", { send } as unknown as KMSClient);
    await expect(provider.wrapKey(Buffer.alloc(16), context)).rejects.toThrow("256 bits");
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects invalid credential contexts", async () => {
    const send = vi.fn();
    const provider = new AwsKmsProvider("alias/agentlogin", "us-east-1", { send } as unknown as KMSClient);
    await expect(provider.wrapKey(Buffer.alloc(32), { ...context, tenantId: "" })).rejects.toThrow("encryption context");
    expect(send).not.toHaveBeenCalled();
  });
});
