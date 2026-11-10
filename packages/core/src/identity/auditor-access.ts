import { Temporal } from "temporal-polyfill";
import { addDays, dateInZone, isBeforeDate } from "../calendar/index.js";

/**
 * TIM-008: an auditor's access is granted "until" a calendar day in the
 * organization's time zone. Access lasts through that whole local day and
 * ends at the local midnight that follows it.
 */

/** Why a requested access end day is refused. */
export type AuditorAccessUntilProblem = "in_past" | "too_far";

/**
 * Checks a requested last day of access against today (in the
 * organization's zone) and the organization's maximum: it may be today, and
 * at most `maxDays` calendar days after today. Returns null when allowed.
 *
 * @example
 * checkAuditorAccessUntil("2026-11-10", "2026-11-10", 90); // => null
 * checkAuditorAccessUntil("2026-11-09", "2026-11-10", 90); // => "in_past"
 * checkAuditorAccessUntil("2027-02-09", "2026-11-10", 90); // => "too_far"
 */
export function checkAuditorAccessUntil(
  accessUntil: string,
  today: string,
  maxDays: number,
): AuditorAccessUntilProblem | null {
  if (isBeforeDate(accessUntil, today)) return "in_past";
  if (isBeforeDate(addDays(today, maxDays), accessUntil)) return "too_far";
  return null;
}

/**
 * The instant access granted until `accessUntil` ends: the local midnight
 * after that day in `timeZone`, as an ISO 8601 UTC string. DST-aware.
 *
 * @example
 * auditorAccessEndInstant("2026-10-25", "Europe/Madrid");
 * // => "2026-10-25T23:00:00Z" (CET again after the fall-back)
 */
export function auditorAccessEndInstant(
  accessUntil: string,
  timeZone: string,
): string {
  return Temporal.PlainDate.from(accessUntil)
    .add({ days: 1 })
    .toZonedDateTime(timeZone)
    .toInstant()
    .toString();
}

/**
 * The last local day on which access ending at `expiresAt` is still
 * granted, in `timeZone`: the day of the instant just before it ends.
 *
 * @example
 * auditorAccessUntilDate(new Date("2026-10-25T23:00:00Z"), "Europe/Madrid");
 * // => "2026-10-25"
 */
export function auditorAccessUntilDate(
  expiresAt: Date,
  timeZone: string,
): string {
  return dateInZone(new Date(expiresAt.getTime() - 1), timeZone);
}
