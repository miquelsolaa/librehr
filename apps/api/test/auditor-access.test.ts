import { describe, expect, it } from "vitest";
import { assertAuditorAccessEnd } from "../src/lib/auditor-access.js";
import { ValidationError } from "../src/errors/index.js";

// TIM-008: an auditor's access end date must be in (now, now + maxDays].
describe("assertAuditorAccessEnd", () => {
  const now = new Date("2026-11-10T12:00:00Z");
  const window = {
    now,
    latest: new Date("2027-02-08T12:00:00Z"),
    maxDays: 90,
  };
  const codeOf = (requested: Date): string | undefined => {
    try {
      assertAuditorAccessEnd(requested, window);
      return undefined;
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      return (err as ValidationError).code;
    }
  };

  it("accepts dates up to and including the latest instant", () => {
    expect(codeOf(new Date("2026-11-10T12:00:01Z"))).toBeUndefined();
    expect(codeOf(window.latest)).toBeUndefined();
  });

  it("rejects now and the past", () => {
    expect(codeOf(now)).toBe("AUDITOR_ACCESS_END_IN_PAST");
    expect(codeOf(new Date("2026-01-01T00:00:00Z"))).toBe(
      "AUDITOR_ACCESS_END_IN_PAST",
    );
  });

  it("rejects dates beyond the maximum", () => {
    expect(codeOf(new Date("2027-02-08T12:00:01Z"))).toBe(
      "AUDITOR_ACCESS_END_TOO_FAR",
    );
  });

  it("rejects an invalid date", () => {
    expect(codeOf(new Date("not a date"))).toBe("VALIDATION_ERROR");
  });
});
