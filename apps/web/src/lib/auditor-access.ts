import { AUDITOR_ACCESS_ERROR_CODES } from "@librehr/contracts";

const DAY_MS = 24 * 60 * 60 * 1000;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** `YYYY-MM-DD` of the browser's local calendar day, `offsetDays` from today. */
export function localDateInput(offsetDays = 0, now = new Date()): string {
  const d = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + offsetDays,
  );
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * The instant an access chosen as "ends on `date`" ends: the last second of
 * that day in the browser's time zone, as an ISO string for the API.
 */
export function endOfLocalDayIso(date: string): string {
  return new Date(`${date}T23:59:59`).toISOString();
}

/**
 * Latest selectable end date: the API refuses an end later than
 * now + maxDays, and the end of the day `maxDays - 1` from today is always
 * within it.
 */
export function latestEndDateInput(maxDays: number, now = new Date()): string {
  return localDateInput(Math.max(0, maxDays - 1), now);
}

/** Whole days until `iso`, rounded up; 0 once it has passed. */
export function daysLeft(iso: string, now = new Date()): number {
  const ms = new Date(iso).getTime() - now.getTime();
  return ms <= 0 ? 0 : Math.ceil(ms / DAY_MS);
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
