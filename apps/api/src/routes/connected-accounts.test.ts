import { describe, expect, it } from "vitest";
import { isCredentialEnrollmentEnabled } from "./connected-accounts.js";

describe("credential enrollment release gate", () => {
  it("fails closed when the environment variable is missing", () => {
    expect(isCredentialEnrollmentEnabled(undefined)).toBe(false);
  });

  it("requires the exact string true", () => {
    expect(isCredentialEnrollmentEnabled("true")).toBe(true);
    expect(isCredentialEnrollmentEnabled("TRUE")).toBe(false);
    expect(isCredentialEnrollmentEnabled("1")).toBe(false);
    expect(isCredentialEnrollmentEnabled("yes")).toBe(false);
    expect(isCredentialEnrollmentEnabled("false")).toBe(false);
    expect(isCredentialEnrollmentEnabled("")).toBe(false);
  });
});
