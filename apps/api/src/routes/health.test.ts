import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";

describe("health routes", () => {
  it("does not confuse liveness, identity readiness, and full production readiness", async () => {
    const app = buildApp();
    const live = await app.inject({ method: "GET", url: "/health" });
    const identity = await app.inject({ method: "GET", url: "/identity/ready" });
    const ready = await app.inject({ method: "GET", url: "/ready" });
    expect(live.statusCode).toBe(200);
    expect(live.json().status).toBe("ok");
    expect(identity.statusCode).toBe(503);
    expect(ready.statusCode).toBe(503);
    await app.close();
  });
});
