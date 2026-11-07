import { describe, expect, it, vi } from "vitest";
import type { Database } from "./client.js";
import { withTenantTransaction } from "./tenant.js";

describe("withTenantTransaction", () => {
  it("fails closed when tenant identity is missing or malformed", async () => {
    const transaction = vi.fn();
    const database = { transaction } as unknown as Database;

    await expect(
      withTenantTransaction(database, "", async () => "unreachable"),
    ).rejects.toThrow("authenticated tenant context");
    await expect(
      withTenantTransaction(database, " tenant-a", async () => "unreachable"),
    ).rejects.toThrow("authenticated tenant context");
    expect(transaction).not.toHaveBeenCalled();
  });

  it("sets tenant context inside the transaction before invoking queries", async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const tx = { execute };
    const transaction = vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) =>
      callback(tx),
    );
    const database = { transaction } as unknown as Database;

    const result = await withTenantTransaction(database, "tenant-a", async () => "ok");

    expect(result).toBe("ok");
    expect(transaction).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledOnce();
  });
});
