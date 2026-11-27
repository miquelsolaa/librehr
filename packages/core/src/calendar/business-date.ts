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
 * Wall-clock time (`HH:MM`, 24 h) of an ISO instant in a time zone. Seconds
 * are dropped, not rounded, so a clock-in at 08:59:59 reads as 08:59.
 *
 * @example
 * localTimeOfDay("2026-03-29T01:30:00Z", "Europe/Madrid"); // => "03:30" (CEST)
 * localTimeOfDay("2026-12-31T23:30:00Z", "Europe/Madrid"); // => "00:30"
 */
export function localTimeOfDay(instant: string, timeZone: string): string {
  const local = Temporal.Instant.from(instant).toZonedDateTimeISO(timeZone);
  return `${String(local.hour).padStart(2, "0")}:${String(local.minute).padStart(2, "0")}`;
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
 * The instants that bound a period of local calendar days in a time zone:
 * local midnight starting `startDate` (inclusive) and local midnight after
 * `endDate` (exclusive), as ISO 8601 UTC strings. DST-aware, so a period
 * holding a change day is 23 or 25 hours longer than its whole days.
 *
 * @example
 * localPeriodBounds("2026-10-25", "2026-10-25", "Europe/Madrid");
 * // => { start: "2026-10-24T22:00:00Z", end: "2026-10-25T23:00:00Z" }
 */
export function localPeriodBounds(
  startDate: string,
  endDate: string,
  timeZone: string,
): { start: string; end: string } {
  const start = Temporal.PlainDate.from(startDate)
    .toZonedDateTime(timeZone)
    .toInstant();
  const end = Temporal.PlainDate.from(endDate)
    .add({ days: 1 })
    .toZonedDateTime(timeZone)
    .toInstant();
  return { start: start.toString(), end: end.toString() };
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

/**
 * The first and last calendar day of a month (`YYYY-MM`), e.g. a timesheet
 * closure period (TIM-004). Leap years are handled by the calendar.
 *
 * @example
 * monthPeriod("2028-02"); // => { startDate: "2028-02-01", endDate: "2028-02-29" }
 */
export function monthPeriod(month: string): {
  startDate: string;
  endDate: string;
} {
  const ym = Temporal.PlainYearMonth.from(month);
  return {
    startDate: ym.toPlainDate({ day: 1 }).toString(),
    endDate: ym.toPlainDate({ day: ym.daysInMonth }).toString(),
  };
}

/**
 * The month (`YYYY-MM`) holding both dates, or null when they fall in
 * different months.
 *
 * @example
 * monthContaining("2026-03-02", "2026-03-31"); // => "2026-03"
 * monthContaining("2026-03-30", "2026-04-02"); // => null
 */
export function monthContaining(
  startDate: string,
  endDate: string,
): string | null {
  const start = Temporal.PlainDate.from(startDate).toPlainYearMonth();
  const end = Temporal.PlainDate.from(endDate).toPlainYearMonth();
  return start.equals(end) ? start.toString() : null;
}

const ISO_DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Whether `value` is a real calendar day written as `YYYY-MM-DD`. A shape
 * check alone accepts impossible days such as 30 February; this rejects them
 * so a bad date is caught at a boundary instead of failing deep inside date
 * arithmetic.
 *
 * @example
 * isValidIsoDate("2028-02-29"); // => true (leap year)
 * isValidIsoDate("2027-02-29"); // => false
 * isValidIsoDate("2027-02-30"); // => false
 * isValidIsoDate("20270201"); // => false (not YYYY-MM-DD)
 */
export function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE_SHAPE.test(value)) return false;
  try {
    Temporal.PlainDate.from(value, { overflow: "reject" });
    return true;
  } catch {
    return false;
  }
}
