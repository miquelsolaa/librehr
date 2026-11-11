import { describe, expect, it } from "vitest";
import {
  auditorAccessBounds,
  resolveAuditorAccessEnd,
} from "../src/lib/auditor-access.js";
import { ValidationError } from "../src/errors/index.js";

// TIM-008: the last day of access is read in the organization's time zone,
// with "today" taken from the database clock.
describe("resolveAuditorAccessEnd", () => {
  // 23:30 UTC on 9 November is already 10 November in Madrid.
  const window = {
    now: new Date("2026-11-09T23:30:00Z"),
    timeZone: "Europe/Madrid",
    maxDays: 90,
  };
  const codeOf = (accessUntil: string): string | undefined => {
    try {
      resolveAuditorAccessEnd(accessUntil, window);
      return undefined;
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      return (err as ValidationError).code;
    }
  };

  it("uses today in the organization's zone", () => {
    expect(auditorAccessBounds(window)).toEqual({
      today: "2026-11-10",
      latestAccessUntil: "2027-02-08",
    });
    expect(codeOf("2026-11-09")).toBe("AUDITOR_ACCESS_END_IN_PAST");
    expect(codeOf("2026-11-10")).toBeUndefined();
  });

  it("ends access at the local midnight after the chosen day", () => {
    expect(resolveAuditorAccessEnd("2026-11-10", window).toISOString()).toBe(
      "2026-11-10T23:00:00.000Z",
    );
  });

  it("rejects days beyond the maximum", () => {
    expect(codeOf("2027-02-08")).toBeUndefined();
    expect(codeOf("2027-02-09")).toBe("AUDITOR_ACCESS_END_TOO_FAR");
  });
});
