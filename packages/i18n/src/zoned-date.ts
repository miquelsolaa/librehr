/** A calendar date as displayed in a time zone; `month` is 1-12. */
export interface ZonedCalendarDate {
  year: number;
  month: number;
  day: number;
}

/**
 * The calendar date of an instant as seen in an IANA time zone, for UI that
 * shows "this month" or "today" in the organization's zone rather than the
 * browser's or UTC.
 *
 * @example
 * calendarDateInZone(new Date("2026-12-31T23:30:00Z"), "Europe/Madrid");
 * // => { year: 2027, month: 1, day: 1 }
 */
export function calendarDateInZone(
  instant: Date,
  timeZone: string,
): ZonedCalendarDate {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  return { year: part("year"), month: part("month"), day: part("day") };
}

/**
 * ISO `YYYY-MM-DD` for a calendar date. The parts are not normalized, so the
 * caller passes a valid date.
 *
 * @example
 * isoDate(2026, 3, 9); // => "2026-03-09"
 */
export function isoDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Number of days in a month (1-12) of the proleptic Gregorian calendar.
 *
 * @example
 * daysInMonth(2028, 2); // => 29
 */
export function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month is the last day of this one; pure calendar maths
  // in UTC, so no local time zone or DST is involved.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
