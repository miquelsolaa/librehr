import { describe, it, expect } from "vitest";
import { IdSchema } from "../src/common.js";

// Zod 4's uuid() enforces RFC 9562 version/variant bits and would reject the
// sequential ids used by fixtures and seeds; IdSchema must keep accepting any
// 8-4-4-4-12 hex id, as Zod 3's uuid() did.
describe("IdSchema", () => {
  it("accepts random and sequential ids", () => {
    expect(
      IdSchema.safeParse("00000000-0000-0000-0000-000000000001").success,
    ).toBe(true);
    expect(
      IdSchema.safeParse("6f1c2a9e-3b7d-4e8f-9a0b-1c2d3e4f5a6b").success,
    ).toBe(true);
  });

  it("rejects ids that are not 8-4-4-4-12 hex", () => {
    for (const bad of [
      "",
      "1",
      "00000000-0000-0000-0000-00000000000g",
      "00000000000000000000000000000001",
      "00000000-0000-0000-0000-0000000000011",
    ]) {
      expect(IdSchema.safeParse(bad).success, bad).toBe(false);
    }
  });
});
