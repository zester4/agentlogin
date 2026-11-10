import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { activityRoutes, decodeActivityCursor, encodeActivityCursor } from "./activity.js";

describe("activity SSE cursors", () => {
  it("round-trips a timestamp and event ID", () => {
    const at = "2026-11-10T22:00:00.123456Z";
    const encoded = encodeActivityCursor(at, "evt_123");
    expect(decodeActivityCursor(encoded)).toEqual({ at, id: "evt_123" });
  });

  it.each(["", "not-base64-json", Buffer.from(JSON.stringify({ at: "not-a-date", id: "evt_1" })).toString("base64url"),
    Buffer.from(JSON.stringify({ at: "2026-11-10T22:00:00Z", id: "evt_1" })).toString("base64url"),
    Buffer.from(JSON.stringify({ at: "2026-11-10T22:00:00.000000Z", id: "" })).toString("base64url")])(
    "rejects malformed cursor %s", (cursor) => {
      expect(decodeActivityCursor(cursor)).toBeNull();
    }
  );

  it("rejects oversized cursor values", () => {
    expect(decodeActivityCursor("a".repeat(513))).toBeNull();
  });
});

describe("activity SSE authorization", () => {
  it("rejects unauthenticated stream requests before opening a connection", async () => {
    const app = Fastify({ logger: false });
    app.decorate("authenticateUser", async () => undefined);
    await activityRoutes(app, { database: {} as never });
    const response = await app.inject({ method: "GET", url: "/v1/activity/stream" });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("rejects malformed Last-Event-ID values before hijacking the response", async () => {
    const app = Fastify({ logger: false });
    app.decorate("authenticateUser", async (request) => {
      request.userPrincipal = { tenantId: "tenant_test", userId: "user_test" } as never;
    });
    await activityRoutes(app, { database: {} as never });
    const response = await app.inject({
      method: "GET",
      url: "/v1/activity/stream",
      headers: { "last-event-id": "not-a-cursor" },
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });
});
