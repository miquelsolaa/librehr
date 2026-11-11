import { AUDITOR_ACCESS_ERROR_CODES } from "@librehr/contracts";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Days of access left counting today, from two `YYYY-MM-DD` days in the
 * organization's time zone (the API sends both): 1 on the last day, 0 once
 * the last day is before today.
 */
export function daysLeft(accessUntil: string, today: string): number {
  const diff =
    Date.parse(`${accessUntil}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`);
  return Math.max(0, Math.round(diff / DAY_MS) + 1);
}

/**
 * Formats a `YYYY-MM-DD` calendar day for display. The day is already in the
 * organization's time zone, so it is formatted as a plain date (UTC), never
 * shifted into the browser's zone.
 */
export function formatCalendarDay(day: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(`${day}T00:00:00Z`));
}

export type AuditorAccessErrorKey =
  "errorTooFar" | "errorInPast" | "actionError";

/** Maps an API problem (RFC 9457) to a translated message key. */
export function auditorAccessErrorKey(err: unknown): AuditorAccessErrorKey {
  const code =
    typeof err === "object" && err !== null && "code" in err
      ? err.code
      : undefined;
  if (code === AUDITOR_ACCESS_ERROR_CODES.tooFar) return "errorTooFar";
  if (code === AUDITOR_ACCESS_ERROR_CODES.inPast) return "errorInPast";
  return "actionError";
}

/** Whether the error concerns the end date field (vs. the form as a whole). */
export function isAccessDateError(key: AuditorAccessErrorKey): boolean {
  return key !== "actionError";
}
