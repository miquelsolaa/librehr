import { describe, expect, it } from "vitest";
import {
  buildLocalPeriodTimesheet,
  createInspectionExport,
  type InspectionExportEmployee,
  type ScheduleSpan,
} from "../src/index.js";
import { baseInput, parseCsv, session } from "./support/inspection-fixtures.js";

const METADATA_LINES = 8;
const ZONE_COLUMN = 10;
const EVERY_DAY: ScheduleSpan[] = [
  {
    isDefault: true,
    effectiveFrom: null,
    effectiveTo: null,
    rules: Array.from({ length: 7 }, (_, i) => ({
      dayOfWeek: i + 1,
      expectedHours: 8,
    })),
  },
];

/** An employee whose days are split in their own zone, as the API does. */
function employeeIn(
  employeeId: string,
  timeZone: string,
  sessions: ReturnType<typeof session>[],
  period: { start: string; end: string },
): InspectionExportEmployee {
  const timesheet = buildLocalPeriodTimesheet({
    startDate: period.start,
    endDate: period.end,
    timeZone,
    sessions,
    schedules: EVERY_DAY,
  });
  if (!timesheet.ok) throw new Error("schedule expected");
  return {
    employeeId,
    name: employeeId,
    timeZone,
    days: timesheet.days,
    correctedDates: [],
    employmentPeriods: null,
  };
}

// TIM-006: each employee's days and times follow that employee's zone.
describe("createInspectionExport time zones (TIM-006)", () => {
  const nov = { start: "2026-11-02", end: "2026-11-02" };
  const shift = [session("2026-11-02T08:00:00Z", "2026-11-02T16:00:00Z")];

  it("shows each employee in their own zone and names it on every row", () => {
    const result = createInspectionExport(
      baseInput({
        scope: "organization",
        locale: "en",
        periodStart: nov.start,
        periodEnd: nov.end,
        employees: [
          employeeIn("madrid", "Europe/Madrid", shift, nov),
          employeeIn("canary", "Atlantic/Canary", shift, nov),
        ],
      }),
    );
    const records = parseCsv(result.csv);
    expect(result.columns[ZONE_COLUMN]).toBe("Time zone");
    expect(records[METADATA_LINES + 1]?.slice(2, 3)).toEqual(["09:00-17:00"]);
    expect(records[METADATA_LINES + 1]?.[ZONE_COLUMN]).toBe("Europe/Madrid");
    expect(records[METADATA_LINES + 2]?.slice(2, 3)).toEqual(["08:00-16:00"]);
    expect(records[METADATA_LINES + 2]?.[ZONE_COLUMN]).toBe("Atlantic/Canary");
    // The header names the organization's zone, not an employee's.
    expect(result.metadataLines).toContain(
      "Organization time zone: Europe/Madrid",
    );
  });

  it("gives an employee the same rows in employee and organization scope", () => {
    const canary = employeeIn("canary", "Atlantic/Canary", shift, nov);
    const alone = createInspectionExport(
      baseInput({
        periodStart: nov.start,
        periodEnd: nov.end,
        employees: [canary],
      }),
    );
    const inOrg = createInspectionExport(
      baseInput({
        scope: "organization",
        periodStart: nov.start,
        periodEnd: nov.end,
        employees: [employeeIn("madrid", "Europe/Madrid", shift, nov), canary],
      }),
    );
    expect(inOrg.rows.filter((r) => r.employeeId === "canary")).toEqual(
      alone.rows,
    );
  });

  it("splits days at each zone's own midnight", () => {
    // 23:30 UTC on 1 Nov is 00:30 on 2 Nov in Madrid, still 1 Nov in Canary.
    const late = [session("2026-11-01T23:30:00Z", "2026-11-02T01:00:00Z")];
    const period = { start: "2026-11-01", end: "2026-11-02" };
    const result = createInspectionExport(
      baseInput({
        scope: "organization",
        periodStart: period.start,
        periodEnd: period.end,
        employees: [
          employeeIn("madrid", "Europe/Madrid", late, period),
          employeeIn("canary", "Atlantic/Canary", late, period),
        ],
      }),
    );
    const cells = (id: string) =>
      result.rows
        .filter((r) => r.employeeId === id)
        .map((r) => [r.date, r.sessions, r.workedMinutes]);
    expect(cells("madrid")).toEqual([
      ["2026-11-01", "", 0],
      ["2026-11-02", "00:30-02:00", 90],
    ]);
    expect(cells("canary")).toEqual([
      ["2026-11-01", "23:30-00:00", 30],
      ["2026-11-02", "00:00-01:00", 60],
    ]);
  });

  it("follows each zone's DST change on the fall-back day", () => {
    // Madrid falls back at 01:00 UTC (03:00 to 02:00), Canary at the same
    // instant (02:00 to 01:00): one hour apart before and after.
    const period = { start: "2026-10-25", end: "2026-10-25" };
    const night = [session("2026-10-25T00:30:00Z", "2026-10-25T01:30:00Z")];
    const result = createInspectionExport(
      baseInput({
        scope: "organization",
        periodStart: period.start,
        periodEnd: period.end,
        employees: [
          employeeIn("madrid", "Europe/Madrid", night, period),
          employeeIn("canary", "Atlantic/Canary", night, period),
        ],
      }),
    );
    expect(result.rows.map((r) => [r.sessions, r.timeZone])).toEqual([
      ["02:30-02:30", "Europe/Madrid"],
      ["01:30-01:30", "Atlantic/Canary"],
    ]);
    expect(result.rows.map((r) => r.workedMinutes)).toEqual([60, 60]);
  });
});
