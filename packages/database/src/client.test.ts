import { describe, expect, it } from "vitest";
import { normalizePostgresSslMode, resolveDatabaseApplicationName } from "./client.js";

describe("normalizePostgresSslMode", () => {
  it.each(["prefer", "require", "verify-ca"])(
    "makes the existing strict TLS behavior explicit for sslmode=%s",
    (sslmode) => {
      const normalized = new URL(
        normalizePostgresSslMode(
          `postgresql://user:pass@db.example.test:5432/app?sslmode=${sslmode}&application_name=agentlogin`,
        ),
      );

      expect(normalized.searchParams.get("sslmode")).toBe("verify-full");
      expect(normalized.searchParams.get("application_name")).toBe("agentlogin");
    },
  );

  it("leaves other SSL modes unchanged", () => {
    const connectionString = "postgresql://user:pass@db.example.test/app?sslmode=disable";
    expect(normalizePostgresSslMode(connectionString)).toBe(connectionString);
  });

  it("preserves non-URL connection strings for node-postgres to validate", () => {
    const connectionString = "host=db.example.test dbname=app sslmode=require";
    expect(normalizePostgresSslMode(connectionString)).toBe(connectionString);
  });
});

describe("resolveDatabaseApplicationName", () => {
  it("defaults to the API identity", () => {
    expect(resolveDatabaseApplicationName(undefined)).toBe("agentlogin-api");
  });

  it("uses a service-specific application name", () => {
    expect(resolveDatabaseApplicationName(" agentlogin-login-worker ")).toBe("agentlogin-login-worker");
  });

  it("rejects values unsafe for PostgreSQL application_name", () => {
    expect(() => resolveDatabaseApplicationName("worker\nsecret")).toThrow();
    expect(() => resolveDatabaseApplicationName("x".repeat(64))).toThrow();
  });
});
