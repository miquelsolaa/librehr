import { Temporal } from "temporal-polyfill";
import type { Clock } from "../ports/clock.js";

/**
 * Business dates are calendar days in the organization's (or location's) time
 * zone, never the UTC date of an instant: at 23:30 UTC on 31 December it is
 * already 1 January in Madrid. Every "today" in the domain comes from here.
 */

/**
 * The ISO calendar date (`YYYY-MM-DD`) of the clock's current instant in a
 * time zone.
 *
 * @example
 * todayInZone("Europe/Madrid", { now: () => new Date("2026-12-31T23:30:00Z") });
 * // => "2027-01-01"
 */
export function todayInZone(timeZone: string, clock: Clock): string {
  return dateInZone(clock.now(), timeZone);
}

/**
 * The ISO calendar date (`YYYY-MM-DD`) of an instant in a time zone.
 *
 * @example
 * dateInZone(new Date("2026-03-29T23:30:00Z"), "Atlantic/Canary"); // => "2026-03-30"
 */
export function dateInZone(instant: Date, timeZone: string): string {
  return Temporal.Instant.fromEpochMilliseconds(instant.getTime())
    .toZonedDateTimeISO(timeZone)
    .toPlainDate()
    .toString();
}

/**
 * Adds (or, when negative, subtracts) calendar days to an ISO date.
 *
 * @example
 * addDays("2028-02-28", 1); // => "2028-02-29"
 * addDays("2027-01-01", -1); // => "2026-12-31"
 */
export function addDays(date: string, days: number): string {
  return Temporal.PlainDate.from(date).add({ days }).toString();
}

/**
 * Every ISO date from `startDate` to `endDate`, both included. Empty when the
 * range is reversed.
 *
 * @example
 * datesInRange("2026-12-30", "2027-01-01");
 * // => ["2026-12-30", "2026-12-31", "2027-01-01"]
 */
export function datesInRange(startDate: string, endDate: string): string[] {
  const last = Temporal.PlainDate.from(endDate);
  const dates: string[] = [];
  for (
    let day = Temporal.PlainDate.from(startDate);
    Temporal.PlainDate.compare(day, last) <= 0;
    day = day.add({ days: 1 })
  ) {
    dates.push(day.toString());
  }
  return dates;
}

/**
 * ISO day of the week of a calendar date: 1 (Monday) to 7 (Sunday).
 *
 * @example
 * isoDayOfWeek("2026-03-29"); // => 7
 */
export function isoDayOfWeek(date: string): number {
  return Temporal.PlainDate.from(date).dayOfWeek;
}

/**
 * Minutes between local midnight and the next local midnight of a date in a
 * time zone: 1440 on most days, 1380 on spring-forward and 1500 on fall-back.
 *
 * @example
 * localDayLengthMinutes("2026-03-29", "Europe/Madrid"); // => 1380
 * localDayLengthMinutes("2026-10-25", "Europe/Madrid"); // => 1500
 */
export function localDayLengthMinutes(date: string, timeZone: string): number {
  const day = Temporal.PlainDate.from(date);
  const start = day.toZonedDateTime(timeZone).epochMilliseconds;
  const end = day.add({ days: 1 }).toZonedDateTime(timeZone).epochMilliseconds;
  return Math.round((end - start) / 60000);
}

/**
 * Whether `date` comes strictly before `other` (both ISO dates).
 *
 * @example
 * isBeforeDate("2026-12-31", "2027-01-01"); // => true
 */
export function isBeforeDate(date: string, other: string): boolean {
  return (
    Temporal.PlainDate.compare(
      Temporal.PlainDate.from(date),
      Temporal.PlainDate.from(other),
    ) < 0
  );
}
