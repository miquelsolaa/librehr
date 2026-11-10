import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  auditorAccessEndInstant,
  auditorAccessUntilDate,
  checkAuditorAccessUntil,
} from "../src/identity/auditor-access.js";
import { addDays } from "../src/calendar/business-date.js";

// TIM-008: auditor access is granted until a local day of the organization.
describe("auditor access until a local day", () => {
  it("allows today up to today + maxDays", () => {
    expect(checkAuditorAccessUntil("2026-11-10", "2026-11-10", 90)).toBeNull();
    expect(checkAuditorAccessUntil("2027-02-08", "2026-11-10", 90)).toBeNull();
    expect(checkAuditorAccessUntil("2026-11-09", "2026-11-10", 90)).toBe(
      "in_past",
    );
    expect(checkAuditorAccessUntil("2027-02-09", "2026-11-10", 90)).toBe(
      "too_far",
    );
  });

  it("crosses leap days and year ends by calendar days", () => {
    expect(checkAuditorAccessUntil("2028-02-29", "2027-12-31", 60)).toBeNull();
    expect(checkAuditorAccessUntil("2028-03-01", "2027-12-31", 60)).toBe(
      "too_far",
    );
  });

  it("ends at the local midnight after the day, across DST changes", () => {
    // Fall-back day (25 h): CEST midnight in, CET midnight out.
    expect(auditorAccessEndInstant("2026-10-25", "Europe/Madrid")).toBe(
      "2026-10-25T23:00:00Z",
    );
    expect(auditorAccessEndInstant("2026-10-24", "Europe/Madrid")).toBe(
      "2026-10-24T22:00:00Z",
    );
    // Spring-forward day (23 h).
    expect(auditorAccessEndInstant("2026-03-29", "Europe/Madrid")).toBe(
      "2026-03-29T22:00:00Z",
    );
    expect(auditorAccessEndInstant("2026-03-29", "Atlantic/Canary")).toBe(
      "2026-03-29T23:00:00Z",
    );
  });

  it("maps the end instant back to the same local day", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 3000 }),
        fc.constantFrom("Europe/Madrid", "Atlantic/Canary", "UTC"),
        (offset, zone) => {
          const day = addDays("2025-01-01", offset);
          const end = new Date(auditorAccessEndInstant(day, zone));
          expect(auditorAccessUntilDate(end, zone)).toBe(day);
        },
      ),
    );
  });
});
