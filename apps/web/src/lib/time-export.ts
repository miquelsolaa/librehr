import { ROLE_PERMISSIONS } from "@librehr/contracts";
import { calendarDateInZone, daysInMonth, isoDate } from "@librehr/i18n";

/** TIM-006: the API rejects longer periods with 400. */
export const MAX_EXPORT_DAYS = 366;

export type ExportLocale = "ca" | "es" | "en";
export type ExportScope = "employee" | "organization";

/** Message keys (in `timeTracking`) for every way an export can fail. */
export type ExportErrorKey =
  | "exportErrorInvalidPeriod"
  | "exportErrorForbidden"
  | "exportErrorNotFound"
  | "exportErrorNoOwnRecord"
  | "scheduleNotConfigured"
  | "exportUnavailable";

function timeRecordScopes(role: string | undefined): string[] {
  if (!role) return [];
  return (ROLE_PERMISSIONS[role] ?? [])
    .filter((p) => p.permission === "time.record.read")
    .map((p) => p.scope);
}

/**
 * Whether the role may export the whole organization (time.record.read at
 * organization scope). Only decides what the UI offers; the API enforces it.
 */
export function canExportOrganization(role: string | undefined): boolean {
  return timeRecordScopes(role).includes("organization");
}

/** Whether the role may export someone else's record (beyond `self`). */
export function canExportOthers(role: string | undefined): boolean {
  return timeRecordScopes(role).some((scope) => scope !== "self");
}

/** First and last day of the current month in the browser's calendar. */
export function currentMonthRange(now = new Date()): {
  startDate: string;
  endDate: string;
} {
  const today = calendarDateInZone(
    now,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  return {
    startDate: isoDate(today.year, today.month, 1),
    endDate: isoDate(
      today.year,
      today.month,
      daysInMonth(today.year, today.month),
    ),
  };
}

/** Same rule as the API: end on or after start, at most 366 days. */
export function isValidExportPeriod(startDate: string, endDate: string) {
  if (!startDate || !endDate || endDate < startDate) return false;
  const days =
    (Date.parse(`${endDate}T00:00:00Z`) -
      Date.parse(`${startDate}T00:00:00Z`)) /
      86_400_000 +
    1;
  return Number.isFinite(days) && days <= MAX_EXPORT_DAYS;
}

/**
 * Maps an API problem to a specific message. A 404 without an employee
 * selected means the caller has no employee record of their own.
 */
export function exportErrorKey(
  err: unknown,
  employeeSelected: boolean,
): ExportErrorKey {
  if (typeof err !== "object" || err === null) return "exportUnavailable";
  const problem = err as { status?: unknown; code?: unknown };
  if (problem.code === "SCHEDULE_NOT_CONFIGURED")
    return "scheduleNotConfigured";
  switch (problem.status) {
    case 400:
      return "exportErrorInvalidPeriod";
    case 403:
      return "exportErrorForbidden";
    case 404:
      return employeeSelected
        ? "exportErrorNotFound"
        : "exportErrorNoOwnRecord";
    case 409:
      return "scheduleNotConfigured";
    default:
      return "exportUnavailable";
  }
}

/** Saves a blob under `filename` through a temporary object URL. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoked on the next tick: some browsers start the download asynchronously.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
