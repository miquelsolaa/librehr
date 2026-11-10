import { localTimeOfDay } from "../calendar/business-date.js";
import { isEmployedOn } from "./employment-periods.js";
import type { InspectionExportLabels } from "./export-labels.js";
import type { WorkSession } from "./fold-sessions.js";
import type { ChainStatus } from "./hash-chain.js";
import type { InspectionExportInput } from "./inspection-export.js";

/** One document row: an employee's day, or an employee without a schedule. */
export interface InspectionExportRow {
  employeeId: string;
  employeeName: string;
  /** Zone of the row's date and times (the employee's). */
  timeZone: string;
  /** Null on a "schedule not configured" row. */
  date: string | null;
  /** Local `HH:MM-HH:MM` intervals joined by ` | `; an open one ends in `-`. */
  sessions: string;
  breakMinutes: number | null;
  workedMinutes: number | null;
  /** 0 on a day the employee was not employed. */
  expectedMinutes: number | null;
  /** Worked minus expected; negative when short. */
  overtimeMinutes: number | null;
  anomaly: boolean | null;
  corrected: boolean | null;
  chainStatus: ChainStatus | null;
  scheduleNotConfigured: boolean;
  /**
   * Whether the day falls inside one of the employee's employment periods
   * (always true when they are unknown); null on a "schedule not configured"
   * row. A day outside them expects nothing, but its recorded work is shown.
   */
  employed: boolean | null;
}

function formatSession(session: WorkSession, timeZone: string): string {
  const start = localTimeOfDay(session.clockIn, timeZone);
  const end = session.clockOut
    ? localTimeOfDay(session.clockOut, timeZone)
    : "";
  return `${start}-${end}`;
}

/**
 * Document rows of the export, one per employee per day (or one per employee
 * without a schedule). On a day outside the employee's employment periods the
 * expected time is 0 and the difference equals the worked time, whatever the
 * day summary says, so the CSV, PDF and JSON never show a fake absence.
 */
export function buildInspectionRows(
  input: Pick<InspectionExportInput, "employees">,
): InspectionExportRow[] {
  const rows: InspectionExportRow[] = [];
  for (const employee of input.employees) {
    const chainStatus = employee.chainStatus ?? null;
    if (employee.days === null) {
      rows.push({
        employeeId: employee.employeeId,
        employeeName: employee.name,
        timeZone: employee.timeZone,
        date: null,
        sessions: "",
        breakMinutes: null,
        workedMinutes: null,
        expectedMinutes: null,
        overtimeMinutes: null,
        anomaly: null,
        corrected: null,
        chainStatus,
        scheduleNotConfigured: true,
        employed: null,
      });
      continue;
    }
    const corrected = new Set(employee.correctedDates);
    for (const day of employee.days) {
      const employed = isEmployedOn(employee.employmentPeriods, day.date);
      rows.push({
        employeeId: employee.employeeId,
        employeeName: employee.name,
        timeZone: employee.timeZone,
        date: day.date,
        sessions: day.sessions
          .map((session) => formatSession(session, employee.timeZone))
          .join(" | "),
        breakMinutes: day.totalBreakMinutes,
        workedMinutes: day.totalWorkedMinutes,
        expectedMinutes: employed ? Math.round(day.expectedHours * 60) : 0,
        overtimeMinutes: employed
          ? day.overtimeMinutes
          : day.totalWorkedMinutes,
        anomaly: day.hasAnomaly,
        corrected: corrected.has(day.date),
        chainStatus,
        scheduleNotConfigured: false,
        employed,
      });
    }
  }
  return rows;
}

/**
 * Display text of each cell of a row, in column order. Shared by the CSV and
 * the PDF so both formats show the same values.
 *
 * @example
 * inspectionRowCells(row, inspectionExportLabels("en"));
 * // => ["Marta Garcia", "2026-11-02", "09:00-17:30", "60", "450", "480", "-30",
 * //     "No", "No", "Verified", "Europe/Madrid", "Yes"]
 */
export function inspectionRowCells(
  row: InspectionExportRow,
  labels: InspectionExportLabels,
): string[] {
  const flag = (value: boolean | null) =>
    value === null ? "" : value ? labels.yes : labels.no;
  const minutes = (value: number | null) =>
    value === null ? "" : String(value);
  return [
    row.employeeName,
    row.date ?? "",
    row.scheduleNotConfigured ? labels.scheduleNotConfigured : row.sessions,
    minutes(row.breakMinutes),
    minutes(row.workedMinutes),
    minutes(row.expectedMinutes),
    minutes(row.overtimeMinutes),
    flag(row.anomaly),
    flag(row.corrected),
    row.chainStatus === null ? "" : labels.chainStatus[row.chainStatus],
    // Appended columns go last, so earlier positions stay stable for consumers.
    row.timeZone,
    flag(row.employed),
  ];
}

/** Indexes of the columns whose cells are numbers (no formula guard). */
export const INSPECTION_NUMERIC_COLUMNS: ReadonlySet<number> = new Set([
  3, 4, 5, 6,
]);

/** Localized table header, in the same order as {@link inspectionRowCells}. */
export function inspectionColumnLabels(
  labels: InspectionExportLabels,
): string[] {
  const c = labels.columns;
  return [
    c.employee,
    c.date,
    c.sessions,
    c.breakMinutes,
    c.workedMinutes,
    c.expectedMinutes,
    c.overtimeMinutes,
    c.anomaly,
    c.corrected,
    c.chainStatus,
    c.timeZone,
    c.employed,
  ];
}
