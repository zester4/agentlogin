import { describe, expect, it } from "vitest";
import { decodeActivityCursor, encodeActivityCursor } from "./activity.js";

describe("activity SSE cursors", () => {
  it("round-trips a timestamp and event ID", () => {
    const at = new Date("2026-11-10T22:00:00.000Z");
    const encoded = encodeActivityCursor(at, "evt_123");
    expect(decodeActivityCursor(encoded)).toEqual({ at, id: "evt_123" });
  });

  it.each(["", "not-base64-json", Buffer.from(JSON.stringify({ at: "not-a-date", id: "evt_1" })).toString("base64url"),
    Buffer.from(JSON.stringify({ at: "2026-11-10T22:00:00Z", id: "evt_1" })).toString("base64url"),
    Buffer.from(JSON.stringify({ at: "2026-11-10T22:00:00.000Z", id: "" })).toString("base64url")])(
    "rejects malformed cursor %s", (cursor) => {
      expect(decodeActivityCursor(cursor)).toBeNull();
    }
  );

  it("rejects oversized cursor values", () => {
    expect(decodeActivityCursor("a".repeat(513))).toBeNull();
  });
});
