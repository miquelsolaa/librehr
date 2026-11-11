import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  buildLocalPeriodTimesheet,
  resolveScheduleForDate,
  type ScheduleSpan,
} from "../src/time/period-timesheet.js";
import type { WorkSession } from "../src/time/fold-sessions.js";
import { addDays, dateInZone } from "../src/calendar/business-date.js";

const allDays = (hours: number) =>
  Array.from({ length: 7 }, (_, i) => ({
    dayOfWeek: i + 1,
    expectedHours: hours,
  }));

const defaultSpan: ScheduleSpan = {
  isDefault: true,
  effectiveFrom: null,
  effectiveTo: null,
  rules: allDays(8),
};

const closed = (clockIn: string, clockOut: string): WorkSession => {
  const minutes = (Date.parse(clockOut) - Date.parse(clockIn)) / 60000;
  return {
    clockIn,
    clockOut,
    isOpen: false,
    breaks: [],
    grossDurationMinutes: minutes,
    totalBreakMinutes: 0,
    netWorkedDurationMinutes: minutes,
  };
};

describe("resolveScheduleForDate", () => {
  const early: ScheduleSpan = {
    isDefault: false,
    effectiveFrom: "2026-01-01",
    effectiveTo: "2026-03-28",
    rules: allDays(6),
  };
  const late: ScheduleSpan = {
    isDefault: false,
    effectiveFrom: "2026-03-29",
    effectiveTo: null,
    rules: allDays(7),
  };

  it("picks the assignment in force, with inclusive bounds", () => {
    const spans = [defaultSpan, late, early];
    expect(resolveScheduleForDate(spans, "2026-03-28")).toBe(early);
    expect(resolveScheduleForDate(spans, "2026-03-29")).toBe(late);
    expect(resolveScheduleForDate(spans, "2027-01-01")).toBe(late);
  });

  it("falls back to the organization default, else null", () => {
    expect(resolveScheduleForDate([defaultSpan, late], "2025-12-31")).toBe(
      defaultSpan,
    );
    expect(resolveScheduleForDate([late], "2025-12-31")).toBeNull();
  });

  it("prefers the latest start when assignments overlap", () => {
    const overlap: ScheduleSpan = { ...late, effectiveFrom: "2026-02-01" };
    expect(resolveScheduleForDate([early, overlap], "2026-02-15")).toBe(
      overlap,
    );
  });
});

describe("buildLocalPeriodTimesheet", () => {
  it("sums a week across the March DST change in Madrid by real elapsed time", () => {
    // 09:00-17:00 local every day from Fri 27 to Mon 30 March 2026. Madrid
    // moves from UTC+1 to UTC+2 on Sunday 29 at 02:00 local.
    const sessions = [
      closed("2026-03-27T08:00:00Z", "2026-03-27T16:00:00Z"),
      closed("2026-03-28T08:00:00Z", "2026-03-28T16:00:00Z"),
      closed("2026-03-29T07:00:00Z", "2026-03-29T15:00:00Z"),
      closed("2026-03-30T07:00:00Z", "2026-03-30T15:00:00Z"),
    ];
    const result = buildLocalPeriodTimesheet({
      startDate: "2026-03-27",
      endDate: "2026-03-30",
      timeZone: "Europe/Madrid",
      sessions,
      schedules: [defaultSpan],
    });
    if (!result.ok) throw new Error("expected a timesheet");
    expect(result.days.map((d) => [d.date, d.totalWorkedMinutes])).toEqual([
      ["2026-03-27", 480],
      ["2026-03-28", 480],
      ["2026-03-29", 480],
      ["2026-03-30", 480],
    ]);
    expect(result.days.map((d) => d.dayOfWeek)).toEqual([5, 6, 7, 1]);
    expect(result.summary.totalWorkedMinutes).toBe(4 * 480);
    expect(result.summary.totalExpectedHours).toBe(32);
    expect(result.summary.totalOvertimeMinutes).toBe(0);
  });

  it("counts a full 23-hour spring-forward day and a 25-hour fall-back day", () => {
    const spring = buildLocalPeriodTimesheet({
      startDate: "2026-03-29",
      endDate: "2026-03-29",
      timeZone: "Europe/Madrid",
      // Local midnight to local midnight on 29 March.
      sessions: [closed("2026-03-28T23:00:00Z", "2026-03-29T22:00:00Z")],
      schedules: [defaultSpan],
    });
    const autumn = buildLocalPeriodTimesheet({
      startDate: "2026-10-25",
      endDate: "2026-10-25",
      timeZone: "Europe/Madrid",
      sessions: [closed("2026-10-24T22:00:00Z", "2026-10-25T23:00:00Z")],
      schedules: [defaultSpan],
    });
    if (!spring.ok || !autumn.ok) throw new Error("expected timesheets");
    expect(spring.summary.totalWorkedMinutes).toBe(23 * 60);
    expect(autumn.summary.totalWorkedMinutes).toBe(25 * 60);
  });

  it("assigns night work to the Canary local day, not the Madrid or UTC day", () => {
    // 23:30 UTC on 31 December is 23:30 in the Canaries and 00:30 in Madrid.
    const session = closed("2026-12-31T23:30:00Z", "2027-01-01T00:30:00Z");
    const canary = buildLocalPeriodTimesheet({
      startDate: "2026-12-31",
      endDate: "2027-01-01",
      timeZone: "Atlantic/Canary",
      sessions: [session],
      schedules: [defaultSpan],
    });
    const madrid = buildLocalPeriodTimesheet({
      startDate: "2026-12-31",
      endDate: "2027-01-01",
      timeZone: "Europe/Madrid",
      sessions: [session],
      schedules: [defaultSpan],
    });
    if (!canary.ok || !madrid.ok) throw new Error("expected timesheets");
    expect(canary.days.map((d) => d.totalWorkedMinutes)).toEqual([30, 30]);
    expect(madrid.days.map((d) => d.totalWorkedMinutes)).toEqual([0, 60]);
  });

  it("uses the schedule in force on each day and reports the first unconfigured day", () => {
    const fromFeb: ScheduleSpan = {
      isDefault: false,
      effectiveFrom: "2028-02-29",
      effectiveTo: null,
      rules: allDays(4),
    };
    const ok = buildLocalPeriodTimesheet({
      startDate: "2028-02-28",
      endDate: "2028-03-01",
      timeZone: "Europe/Madrid",
      sessions: [],
      schedules: [defaultSpan, fromFeb],
    });
    if (!ok.ok) throw new Error("expected a timesheet");
    expect(ok.days.map((d) => d.expectedHours)).toEqual([8, 4, 4]);

    expect(
      buildLocalPeriodTimesheet({
        startDate: "2028-02-28",
        endDate: "2028-03-01",
        timeZone: "Europe/Madrid",
        sessions: [],
        schedules: [fromFeb],
      }),
    ).toEqual({
      ok: false,
      reason: "SCHEDULE_NOT_CONFIGURED",
      date: "2028-02-28",
    });
  });

  it("splits any closed session without losing or inventing minutes (property)", () => {
    const zones = ["Europe/Madrid", "Atlantic/Canary", "UTC"];
    fc.assert(
      fc.property(
        // Instants within 2026, so the session sits inside the period below.
        fc.integer({
          min: Date.UTC(2026, 0, 2),
          max: Date.UTC(2026, 11, 28),
        }),
        fc.integer({ min: 1, max: 36 * 60 }),
        fc.constantFrom(...zones),
        (startMs, minutes, zone) => {
          const session = closed(
            new Date(startMs).toISOString(),
            new Date(startMs + minutes * 60000).toISOString(),
          );
          const first = dateInZone(new Date(startMs), zone);
          const result = buildLocalPeriodTimesheet({
            startDate: addDays(first, -1),
            endDate: addDays(first, 3),
            timeZone: zone,
            sessions: [session],
            schedules: [defaultSpan],
          });
          return result.ok && result.summary.totalWorkedMinutes === minutes;
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe("buildLocalPeriodTimesheet with employment periods (TIM-006)", () => {
  it("needs no schedule on days outside employment", () => {
    const result = buildLocalPeriodTimesheet({
      startDate: "2026-11-02",
      endDate: "2026-11-03",
      timeZone: "Europe/Madrid",
      sessions: [closed("2026-11-02T08:00:00Z", "2026-11-02T09:00:00Z")],
      schedules: [],
      employmentPeriods: [],
    });
    if (!result.ok) throw new Error("expected ok");
    expect(result.days.map((d) => d.expectedHours)).toEqual([0, 0]);
    expect(result.summary.totalWorkedMinutes).toBe(60);
    expect(result.summary.totalOvertimeMinutes).toBe(60);
  });

  it("still requires a schedule on employed days", () => {
    const result = buildLocalPeriodTimesheet({
      startDate: "2026-11-02",
      endDate: "2026-11-03",
      timeZone: "Europe/Madrid",
      sessions: [],
      schedules: [],
      employmentPeriods: [{ start: "2026-11-03", end: null }],
    });
    expect(result).toEqual({
      ok: false,
      reason: "SCHEDULE_NOT_CONFIGURED",
      date: "2026-11-03",
    });
  });

  it("totals only employed days' expected hours", () => {
    const result = buildLocalPeriodTimesheet({
      startDate: "2026-11-02",
      endDate: "2026-11-04",
      timeZone: "Europe/Madrid",
      sessions: [],
      schedules: [defaultSpan],
      employmentPeriods: [{ start: "2025-01-01", end: "2026-11-02" }],
    });
    if (!result.ok) throw new Error("expected ok");
    expect(result.summary.totalExpectedHours).toBe(8);
    expect(result.summary.totalOvertimeMinutes).toBe(-480);
  });
});
