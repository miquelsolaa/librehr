import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  hashKioskPin,
  verifyKioskPin,
  legacyKioskPinHashForTests,
} from "../src/time/kiosk.js";
import { isWithinClockWindow } from "../src/time/clock-window.js";

describe("kiosk PIN hashing (TIM-010)", () => {
  it("stores PINs as salted scrypt and verifies them", async () => {
    const stored = await hashKioskPin("4821");
    expect(stored).toMatch(/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
    expect(await hashKioskPin("4821")).not.toBe(stored);
    expect(await verifyKioskPin("4821", stored, null)).toEqual({
      valid: true,
      needsRehash: false,
    });
    expect((await verifyKioskPin("4822", stored, null)).valid).toBe(false);
    expect((await verifyKioskPin("", stored, null)).valid).toBe(false);
  });

  it("accepts a legacy SHA-256 PIN and asks for a rehash", async () => {
    const salt = "0123456789abcdef0123456789abcdef";
    const legacy = legacyKioskPinHashForTests("9876", salt);
    expect(await verifyKioskPin("9876", legacy, salt)).toEqual({
      valid: true,
      needsRehash: true,
    });
    expect(await verifyKioskPin("0000", legacy, salt)).toEqual({
      valid: false,
      needsRehash: false,
    });
    // A legacy hash without its salt cannot match.
    expect((await verifyKioskPin("9876", legacy, null)).valid).toBe(false);
  });

  it("rejects missing or malformed stored hashes", async () => {
    expect((await verifyKioskPin("1234", null, null)).valid).toBe(false);
    expect((await verifyKioskPin("1234", "scrypt$zz$zz", null)).valid).toBe(
      false,
    );
  });
});

describe("clock window (TIM-002 / TIM-003)", () => {
  const now = new Date("2026-11-02T08:00:00.000Z");
  const twoMinutes = 120_000;

  it("accepts small skews and rejects backdated or future punches", () => {
    expect(
      isWithinClockWindow(new Date("2026-11-02T07:59:30Z"), now, twoMinutes),
    ).toBe(true);
    expect(
      isWithinClockWindow(new Date("2026-11-02T07:50:00Z"), now, twoMinutes),
    ).toBe(false);
    expect(
      isWithinClockWindow(new Date("2026-11-02T08:10:00Z"), now, twoMinutes),
    ).toBe(false);
    expect(isWithinClockWindow(new Date("invalid"), now, twoMinutes)).toBe(
      false,
    );
  });

  it("property: inside iff |skew| <= tolerance (inclusive)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -600_000, max: 600_000 }),
        fc.integer({ min: 0, max: 300_000 }),
        (skew, tolerance) => {
          const at = new Date(now.getTime() + skew);
          expect(isWithinClockWindow(at, now, tolerance)).toBe(
            Math.abs(skew) <= tolerance,
          );
        },
      ),
    );
  });
});
