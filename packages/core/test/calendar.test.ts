import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { calculateWorkingDays } from "../src/calendar/working-days.js";
import { isHoliday } from "../src/calendar/holidays.js";
import { SystemClock } from "../src/ports/clock.js";

describe("Calendar Working Days Calculation", () => {
  it("exercises isHoliday and SystemClock", () => {
    const holidaySet = new Set(["2026-12-25"]);
    expect(isHoliday("2026-12-25", holidaySet)).toBe(true);
    expect(isHoliday("2026-12-26", holidaySet)).toBe(false);

    const clock = new SystemClock();
    expect(clock.now()).toBeInstanceOf(Date);
  });

  it("throws when startDate > endDate", () => {
    expect(() =>
      calculateWorkingDays({
        startDate: "2026-11-10",
        endDate: "2026-11-05",
      }),
    ).toThrow(/must be on or before/);
  });
  it("calculates standard 5-day working week without holidays", () => {
    // 2026-11-02 (Monday) to 2026-11-06 (Friday) = 5 working days
    const result = calculateWorkingDays({
      startDate: "2026-11-02",
      endDate: "2026-11-06",
    });

    expect(result.totalCalendarDays).toBe(5);
    expect(result.totalWorkingDays).toBe(5);
    expect(result.breakdown.workingDays.length).toBe(5);
    expect(result.breakdown.weekendDays.length).toBe(0);
  });

  it("excludes weekends correctly across a two-week span", () => {
    // 2026-11-02 (Monday) to 2026-11-15 (Sunday) = 14 calendar days, 10 working days, 4 weekend days
    const result = calculateWorkingDays({
      startDate: "2026-11-02",
      endDate: "2026-11-15",
    });

    expect(result.totalCalendarDays).toBe(14);
    expect(result.totalWorkingDays).toBe(10);
    expect(result.breakdown.weekendDays.length).toBe(4);
  });

  it("excludes declared holidays falling on working days", () => {
    // 2026-12-07 (Monday) to 2026-12-11 (Friday)
    // 2026-12-08 is Inmaculada Concepción (Tuesday)
    const holidays = new Set(["2026-12-08"]);
    const result = calculateWorkingDays({
      startDate: "2026-12-07",
      endDate: "2026-12-11",
      holidays,
    });

    expect(result.totalWorkingDays).toBe(4);
    expect(result.breakdown.holidayDays).toEqual(["2026-12-08"]);
  });

  it("handles half-day start and half-day end", () => {
    // 2026-11-02 (Monday) to 2026-11-04 (Wednesday) = 3 working days
    // halfDayStart + halfDayEnd => 3 - 0.5 - 0.5 = 2.0 working days
    const result = calculateWorkingDays({
      startDate: "2026-11-02",
      endDate: "2026-11-04",
      halfDayStart: true,
      halfDayEnd: true,
    });

    expect(result.totalWorkingDays).toBe(2);
  });

  it("handles single-day half day without double deduction", () => {
    const result = calculateWorkingDays({
      startDate: "2026-11-02",
      endDate: "2026-11-02",
      halfDayStart: true,
    });

    expect(result.totalWorkingDays).toBe(0.5);
  });

  it("correctly handles leap year February 29 (e.g. 2028-02-29)", () => {
    // 2028-02-28 (Monday) to 2028-03-01 (Wednesday)
    // 2028 is a leap year; Feb has 29 days (Tuesday)
    const result = calculateWorkingDays({
      startDate: "2028-02-28",
      endDate: "2028-03-01",
    });

    expect(result.totalCalendarDays).toBe(3);
    expect(result.totalWorkingDays).toBe(3);
    expect(result.breakdown.workingDays).toContain("2028-02-29");
  });

  it("correctly handles DST transition weekends in Spain", () => {
    // March 2026 DST start (clocks forward): Sunday 2026-03-29
    const springResult = calculateWorkingDays({
      startDate: "2026-03-27", // Friday
      endDate: "2026-03-30", // Monday
    });
    expect(springResult.totalCalendarDays).toBe(4);
    expect(springResult.totalWorkingDays).toBe(2);

    // October 2026 DST end (clocks back): Sunday 2026-10-25
    const autumnResult = calculateWorkingDays({
      startDate: "2026-10-23", // Friday
      endDate: "2026-10-26", // Monday
    });
    expect(autumnResult.totalCalendarDays).toBe(4);
    expect(autumnResult.totalWorkingDays).toBe(2);
  });

  it("property-based test: workingDays is always <= calendarDays and >= 0", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 28 }),
        fc.integer({ min: 1, max: 28 }),
        (day1, day2) => {
          const startDay = Math.min(day1, day2);
          const endDay = Math.max(day1, day2);
          const startDate = `2026-06-${startDay.toString().padStart(2, "0")}`;
          const endDate = `2026-06-${endDay.toString().padStart(2, "0")}`;

          const res = calculateWorkingDays({ startDate, endDate });
          expect(res.totalWorkingDays).toBeLessThanOrEqual(
            res.totalCalendarDays,
          );
          expect(res.totalWorkingDays).toBeGreaterThanOrEqual(0);
        },
      ),
    );
  });
});
