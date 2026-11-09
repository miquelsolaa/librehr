import { describe, expect, it } from "vitest";
import { calendarDateInZone, daysInMonth, isoDate } from "../src/zoned-date.js";

describe("calendarDateInZone", () => {
  it("shows the organization's month, not the UTC month, near midnight", () => {
    const newYearsEve = new Date("2026-12-31T23:30:00Z");
    expect(calendarDateInZone(newYearsEve, "Europe/Madrid")).toEqual({
      year: 2027,
      month: 1,
      day: 1,
    });
    expect(calendarDateInZone(newYearsEve, "Atlantic/Canary")).toEqual({
      year: 2026,
      month: 12,
      day: 31,
    });
  });

  it("follows Madrid across the DST changes", () => {
    expect(
      calendarDateInZone(new Date("2026-03-28T23:00:00Z"), "Europe/Madrid"),
    ).toEqual({ year: 2026, month: 3, day: 29 });
    expect(
      calendarDateInZone(new Date("2026-10-31T23:00:00Z"), "Europe/Madrid"),
    ).toEqual({ year: 2026, month: 11, day: 1 });
  });
});

describe("calendar helpers", () => {
  it("formats ISO dates and counts days including leap years", () => {
    expect(isoDate(2026, 3, 9)).toBe("2026-03-09");
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2027, 2)).toBe(28);
    expect(daysInMonth(2026, 12)).toBe(31);
    expect(daysInMonth(2026, 11)).toBe(30);
  });
});
