import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  addDays,
  buildLocalPeriodTimesheet,
  createInspectionExport,
  datesInRange,
  inspectionExportLabels,
  INSPECTION_EXPORT_LOCALES,
  isEmployedOn,
  type EmploymentPeriod,
  type InspectionExportEmployee,
  type ScheduleSpan,
} from "../src/index.js";
import { baseInput, parseCsv, session } from "./support/inspection-fixtures.js";

const METADATA_LINES = 8;
const EMPLOYED_COLUMN = 11;
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

/** An employee built as the API does: timesheet first, then the export. */
function employee(
  start: string,
  end: string,
  periods: readonly EmploymentPeriod[] | null,
  sessions: ReturnType<typeof session>[] = [],
  timeZone = "Europe/Madrid",
): InspectionExportEmployee {
  const timesheet = buildLocalPeriodTimesheet({
    startDate: start,
    endDate: end,
    timeZone,
    sessions,
    schedules: EVERY_DAY,
    employmentPeriods: periods,
  });
  if (!timesheet.ok) throw new Error("schedule expected");
  return {
    employeeId: "e1",
    name: "Marta Garcia",
    timeZone,
    days: timesheet.days,
    correctedDates: [],
    employmentPeriods: periods,
  };
}

function exportOf(start: string, end: string, emp: InspectionExportEmployee) {
  return createInspectionExport(
    baseInput({ periodStart: start, periodEnd: end, employees: [emp] }),
  );
}

const flags = (
  start: string,
  end: string,
  periods: EmploymentPeriod[] | null,
) =>
  exportOf(start, end, employee(start, end, periods)).rows.map((row) => [
    row.date,
    row.employed,
    row.expectedMinutes,
  ]);

describe("isEmployedOn", () => {
  const periods = [
    { start: "2026-01-01", end: "2026-03-31" },
    { start: "2026-06-01", end: null },
  ];
  it("includes both ends and open-ended periods", () => {
    expect(isEmployedOn(periods, "2025-12-31")).toBe(false);
    expect(isEmployedOn(periods, "2026-01-01")).toBe(true);
    expect(isEmployedOn(periods, "2026-03-31")).toBe(true);
    expect(isEmployedOn(periods, "2026-04-01")).toBe(false);
    expect(isEmployedOn(periods, "2026-05-31")).toBe(false);
    expect(isEmployedOn(periods, "2026-06-01")).toBe(true);
    expect(isEmployedOn(periods, "2099-12-31")).toBe(true);
  });
  it("treats unknown periods as always employed and none as never", () => {
    expect(isEmployedOn(null, "2026-01-01")).toBe(true);
    expect(isEmployedOn([], "2026-01-01")).toBe(false);
  });
});

describe("createInspectionExport employment days (TIM-006)", () => {
  it("does not expect work before the hire date", () => {
    expect(
      flags("2026-11-02", "2026-11-04", [{ start: "2026-11-03", end: null }]),
    ).toEqual([
      ["2026-11-02", false, 0],
      ["2026-11-03", true, 480],
      ["2026-11-04", true, 480],
    ]);
  });

  it("does not expect work after the employment ended", () => {
    expect(
      flags("2026-11-02", "2026-11-04", [
        { start: "2025-01-01", end: "2026-11-02" },
      ]),
    ).toEqual([
      ["2026-11-02", true, 480],
      ["2026-11-03", false, 0],
      ["2026-11-04", false, 0],
    ]);
  });

  it("leaves the gap between two employments unexpected", () => {
    expect(
      flags("2026-11-02", "2026-11-05", [
        { start: "2026-01-01", end: "2026-11-02" },
        { start: "2026-11-05", end: null },
      ]).map(([, employed]) => employed),
    ).toEqual([true, false, false, true]);
  });

  it("treats unknown periods as employed every day", () => {
    expect(
      flags("2026-11-02", "2026-11-03", null).map(([, employed]) => employed),
    ).toEqual([true, true]);
  });

  it("still lists work recorded on a day outside employment, as overtime", () => {
    const emp = employee(
      "2026-11-02",
      "2026-11-02",
      [{ start: "2026-12-01", end: null }],
      [session("2026-11-02T08:00:00Z")], // open: an anomaly too
    );
    const closed = employee(
      "2026-11-02",
      "2026-11-02",
      [{ start: "2026-12-01", end: null }],
      [session("2026-11-02T08:00:00Z", "2026-11-02T10:00:00Z")],
    );
    const [open] = exportOf("2026-11-02", "2026-11-02", emp).rows;
    const [row] = exportOf("2026-11-02", "2026-11-02", closed).rows;
    expect(open).toMatchObject({ employed: false, anomaly: true });
    expect(open?.sessions).toBe("09:00-");
    expect(row).toMatchObject({
      sessions: "09:00-11:00",
      workedMinutes: 120,
      expectedMinutes: 0,
      overtimeMinutes: 120,
      employed: false,
    });
  });

  it("zeroes expected time even when the day summary expected some", () => {
    const emp = employee("2026-11-02", "2026-11-02", null);
    const result = createInspectionExport(
      baseInput({
        periodStart: "2026-11-02",
        periodEnd: "2026-11-02",
        employees: [{ ...emp, employmentPeriods: [] }],
      }),
    );
    expect(result.rows[0]).toMatchObject({
      expectedMinutes: 0,
      overtimeMinutes: 0,
      employed: false,
    });
  });

  it("splits days in the employee's zone across the October DST change", () => {
    // 2026-10-25 is 25 hours long in Madrid; hired that day.
    const emp = employee(
      "2026-10-24",
      "2026-10-26",
      [{ start: "2026-10-25", end: null }],
      [session("2026-10-24T22:30:00Z", "2026-10-25T01:30:00Z")],
    );
    const rows = exportOf("2026-10-24", "2026-10-26", emp).rows;
    expect(rows.map((r) => [r.date, r.employed, r.workedMinutes])).toEqual([
      ["2026-10-24", false, 0],
      ["2026-10-25", true, 180],
      ["2026-10-26", true, 0],
    ]);
  });

  it("follows periods across a year boundary", () => {
    expect(
      flags("2026-12-30", "2027-01-02", [
        { start: "2026-06-01", end: "2026-12-31" },
        { start: "2027-01-02", end: null },
      ]).map(([, employed]) => employed),
    ).toEqual([true, true, false, true]);
  });

  it("writes the Employed column in every locale", () => {
    for (const locale of INSPECTION_EXPORT_LOCALES) {
      const labels = inspectionExportLabels(locale);
      const result = createInspectionExport(
        baseInput({
          locale,
          periodStart: "2026-11-02",
          periodEnd: "2026-11-03",
          employees: [
            employee("2026-11-02", "2026-11-03", [
              { start: "2026-11-03", end: null },
            ]),
          ],
        }),
      );
      const records = parseCsv(result.csv);
      expect(records[METADATA_LINES]?.[EMPLOYED_COLUMN]).toBe(
        labels.columns.employed,
      );
      expect(records[METADATA_LINES + 1]?.[EMPLOYED_COLUMN]).toBe(labels.no);
      expect(records[METADATA_LINES + 2]?.[EMPLOYED_COLUMN]).toBe(labels.yes);
    }
    expect(inspectionExportLabels("ca").columns.employed).toBe("Contractat");
    expect(inspectionExportLabels("es").columns.employed).toBe("Contratado");
    expect(inspectionExportLabels("en").columns.employed).toBe("Employed");
  });

  it("changes the content hash when the employed flag changes", () => {
    const base = employee("2026-11-02", "2026-11-02", null);
    const hashOf = (periods: EmploymentPeriod[] | null) =>
      createInspectionExport(
        baseInput({
          periodStart: "2026-11-02",
          periodEnd: "2026-11-02",
          employees: [{ ...base, employmentPeriods: periods }],
        }),
      ).contentHash;
    expect(hashOf(null)).toBe(hashOf([{ start: "2026-01-01", end: null }]));
    expect(hashOf(null)).not.toBe(hashOf([{ start: "2026-11-03", end: null }]));
  });

  it("never expects work on a day outside employment (property)", () => {
    const day = fc
      .integer({ min: 0, max: 60 })
      .map((n) => addDays("2026-10-01", n));
    const period = fc
      .tuple(day, fc.option(fc.integer({ min: 0, max: 30 }), { nil: null }))
      .map(([start, length]) => ({
        start,
        end: length === null ? null : addDays(start, length),
      }));
    fc.assert(
      fc.property(
        fc.option(fc.array(period, { maxLength: 3 }), { nil: null }),
        (periods) => {
          const start = "2026-10-20";
          const end = "2026-11-10";
          const rows = exportOf(start, end, employee(start, end, periods)).rows;
          expect(rows.map((r) => r.date)).toEqual(datesInRange(start, end));
          for (const row of rows) {
            expect(row.employed).toBe(isEmployedOn(periods, row.date!));
            if (row.employed === false) {
              expect(row.expectedMinutes).toBe(0);
              expect(row.overtimeMinutes).toBe(row.workedMinutes);
            }
          }
        },
      ),
    );
  });
});
