import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { Temporal } from "temporal-polyfill";
import {
  addDays,
  dateInZone,
  datesInRange,
  isBeforeDate,
  isoDayOfWeek,
  localDayLengthMinutes,
  localTimeOfDay,
  todayInZone,
} from "../src/calendar/business-date.js";
import type { Clock } from "../src/ports/clock.js";
import { computeChecklistTaskDueDates } from "../src/lifecycle/checklists.js";
import { renderDocumentTemplate } from "../src/documents/merge-templates.js";

const at = (iso: string): Clock => ({ now: () => new Date(iso) });

describe("todayInZone", () => {
  it("is already the new year in Madrid at 23:30 UTC on 31 December", () => {
    expect(todayInZone("Europe/Madrid", at("2026-12-31T23:30:00Z"))).toBe(
      "2027-01-01",
    );
    expect(todayInZone("UTC", at("2026-12-31T23:30:00Z"))).toBe("2026-12-31");
  });

  it("is still the old year in the Canaries (UTC+0 in winter) at 23:30 UTC", () => {
    expect(todayInZone("Atlantic/Canary", at("2026-12-31T23:30:00Z"))).toBe(
      "2026-12-31",
    );
    expect(todayInZone("Atlantic/Canary", at("2027-01-01T00:00:00Z"))).toBe(
      "2027-01-01",
    );
  });

  it("follows summer time near midnight UTC", () => {
    // Madrid is UTC+2 in summer: 22:00 UTC is already midnight.
    expect(todayInZone("Europe/Madrid", at("2026-07-14T21:59:59Z"))).toBe(
      "2026-07-14",
    );
    expect(todayInZone("Europe/Madrid", at("2026-07-14T22:00:00Z"))).toBe(
      "2026-07-15",
    );
    // Canaries are UTC+1 in summer.
    expect(todayInZone("Atlantic/Canary", at("2026-07-14T22:30:00Z"))).toBe(
      "2026-07-14",
    );
    expect(todayInZone("Atlantic/Canary", at("2026-07-14T23:00:00Z"))).toBe(
      "2026-07-15",
    );
  });

  it("handles the spring-forward and fall-back nights in Madrid", () => {
    // Last Sunday of March 2026: 02:00 local jumps to 03:00 (01:00 UTC).
    expect(todayInZone("Europe/Madrid", at("2026-03-28T22:59:00Z"))).toBe(
      "2026-03-28",
    );
    expect(todayInZone("Europe/Madrid", at("2026-03-28T23:00:00Z"))).toBe(
      "2026-03-29",
    );
    // Last Sunday of October 2026: 03:00 local falls back to 02:00 (01:00 UTC).
    expect(todayInZone("Europe/Madrid", at("2026-10-24T21:59:00Z"))).toBe(
      "2026-10-24",
    );
    expect(todayInZone("Europe/Madrid", at("2026-10-24T22:00:00Z"))).toBe(
      "2026-10-25",
    );
    expect(todayInZone("Europe/Madrid", at("2026-10-25T22:59:00Z"))).toBe(
      "2026-10-25",
    );
    expect(todayInZone("Europe/Madrid", at("2026-10-25T23:00:00Z"))).toBe(
      "2026-10-26",
    );
  });

  it("reaches 29 February in a leap year", () => {
    expect(todayInZone("Europe/Madrid", at("2028-02-28T23:30:00Z"))).toBe(
      "2028-02-29",
    );
  });

  it("matches the local wall-clock date for any instant (property)", () => {
    const zones = ["Europe/Madrid", "Atlantic/Canary", "UTC"];
    fc.assert(
      fc.property(
        fc.integer({ min: Date.UTC(2000, 0, 1), max: Date.UTC(2060, 0, 1) }),
        fc.constantFrom(...zones),
        (ms, zone) => {
          const date = todayInZone(zone, { now: () => new Date(ms) });
          const local = Temporal.PlainDate.from(date);
          const start = local.toZonedDateTime(zone).epochMilliseconds;
          const end = local
            .add({ days: 1 })
            .toZonedDateTime(zone).epochMilliseconds;
          return start <= ms && ms < end;
        },
      ),
    );
  });

  it("dateInZone agrees with todayInZone", () => {
    const instant = new Date("2026-03-29T23:30:00Z");
    expect(dateInZone(instant, "Atlantic/Canary")).toBe("2026-03-30");
    expect(dateInZone(instant, "Europe/Madrid")).toBe("2026-03-30");
    expect(dateInZone(instant, "UTC")).toBe("2026-03-29");
  });
});

describe("calendar date arithmetic", () => {
  it("adds and subtracts days across month, year and leap-day boundaries", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2027-02-28", 1)).toBe("2027-03-01");
    expect(addDays("2026-03-28", 1)).toBe("2026-03-29");
    expect(addDays("2026-03-29", 1)).toBe("2026-03-30");
  });

  it("addDays is invertible and consistent with datesInRange (property)", () => {
    const day = fc
      .integer({ min: 0, max: 365 * 60 })
      .map((n) => addDays("2000-01-01", n));
    fc.assert(
      fc.property(day, fc.integer({ min: 0, max: 400 }), (start, n) => {
        const end = addDays(start, n);
        const range = datesInRange(start, end);
        return (
          addDays(end, -n) === start &&
          range.length === n + 1 &&
          range[0] === start &&
          range[n] === end
        );
      }),
    );
  });

  it("iterates a range across the year boundary and is empty when reversed", () => {
    expect(datesInRange("2026-12-30", "2027-01-02")).toEqual([
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
    ]);
    expect(datesInRange("2027-01-02", "2027-01-01")).toEqual([]);
  });

  it("returns ISO weekdays and compares dates", () => {
    expect(isoDayOfWeek("2026-03-29")).toBe(7);
    expect(isoDayOfWeek("2026-03-30")).toBe(1);
    expect(isoDayOfWeek("2028-02-29")).toBe(2);
    expect(isBeforeDate("2026-12-31", "2027-01-01")).toBe(true);
    expect(isBeforeDate("2027-01-01", "2027-01-01")).toBe(false);
  });

  it("measures local day length on DST days", () => {
    expect(localDayLengthMinutes("2026-03-29", "Europe/Madrid")).toBe(1380);
    expect(localDayLengthMinutes("2026-10-25", "Europe/Madrid")).toBe(1500);
    expect(localDayLengthMinutes("2026-03-29", "Atlantic/Canary")).toBe(1380);
    expect(localDayLengthMinutes("2026-10-25", "Atlantic/Canary")).toBe(1500);
    expect(localDayLengthMinutes("2026-11-09", "Europe/Madrid")).toBe(1440);
    expect(localDayLengthMinutes("2026-03-29", "UTC")).toBe(1440);
  });
});

describe("business-date call sites in core", () => {
  it("computes checklist due dates with calendar arithmetic against the given today", () => {
    const tasks = [
      { title: "Before", assignedRole: "employee" as const, dueOffsetDays: -1 },
      { title: "Leap", assignedRole: "manager" as const, dueOffsetDays: 1 },
    ];
    const year = computeChecklistTaskDueDates(
      tasks,
      "2027-01-01",
      "2027-01-01",
    );
    expect(year[0]).toMatchObject({ dueDate: "2026-12-31", isOverdue: true });
    const leap = computeChecklistTaskDueDates(
      tasks,
      "2028-02-28",
      "2028-02-29",
    );
    expect(leap[1]).toMatchObject({ dueDate: "2028-02-29", isOverdue: false });
    expect(leap[0]).toMatchObject({ dueDate: "2028-02-27", isOverdue: true });
  });

  it("does not invent a UTC current date for templates", () => {
    expect(renderDocumentTemplate("Date: {{current_date}}", {}, "[N/A]")).toBe(
      "Date: [N/A]",
    );
    expect(
      renderDocumentTemplate(
        "Date: {{current_date}}",
        { currentDate: "2027-01-01" },
        "[N/A]",
      ),
    ).toBe("Date: 2027-01-01");
  });
});

describe("localTimeOfDay", () => {
  it("shows wall-clock HH:MM across DST changes and the year boundary", () => {
    expect(localTimeOfDay("2026-03-29T00:30:00Z", "Europe/Madrid")).toBe(
      "01:30",
    );
    expect(localTimeOfDay("2026-03-29T01:30:00Z", "Europe/Madrid")).toBe(
      "03:30",
    );
    expect(localTimeOfDay("2026-10-25T00:30:00Z", "Europe/Madrid")).toBe(
      "02:30",
    );
    expect(localTimeOfDay("2026-10-25T01:30:00Z", "Europe/Madrid")).toBe(
      "02:30",
    );
    expect(localTimeOfDay("2026-12-31T23:30:00Z", "Europe/Madrid")).toBe(
      "00:30",
    );
    expect(localTimeOfDay("2026-12-31T23:30:00Z", "Atlantic/Canary")).toBe(
      "23:30",
    );
  });

  it("drops seconds instead of rounding", () => {
    expect(localTimeOfDay("2026-11-02T07:59:59Z", "Europe/Madrid")).toBe(
      "08:59",
    );
  });
});
