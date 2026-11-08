import { describe, expect, it } from "vitest";
import { OriginSchema } from "./index.js";

describe("origin schema", () => {
  it("accepts a canonical HTTP(S) origin", () => {
    expect(OriginSchema.safeParse("https://example.com").success).toBe(true);
    expect(OriginSchema.safeParse("http://localhost:3000").success).toBe(true);
  });

  it.each([
    "https://example.com/",
    "https://example.com/path",
    "https://example.com?next=/account",
    "https://example.com#fragment",
    "https://example.com:443",
    "https://user:pass@example.com",
    "javascript:alert(1)"
  ])("rejects a non-canonical or unsupported origin: %s", (origin) => {
    expect(OriginSchema.safeParse(origin).success).toBe(false);
  });
});
