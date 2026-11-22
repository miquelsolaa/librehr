import { Temporal } from "temporal-polyfill";
import type { OpenAtDayEnd } from "./open-at-day-end.js";

/**
 * The shift an employee is rostered for on one calendar date, as wall-clock
 * times in their business time zone (a shift template on the roster).
 */
export interface ScheduledShift {
  /** Template type (morning, afternoon, night, rest). */
  type: string;
  /** "HH:mm" on the rostered date. */
  startTime: string;
  /** "HH:mm"; at or before `startTime` means it ends the next day. */
  endTime: string;
}

const HH_MM = /^([01]\d|2[0-3]):([0-5]\d)$/;

function minutesOfDay(time: string): number | null {
  const match = HH_MM.exec(time);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * TIM-003: whether a rostered shift is still running after the local midnight
 * that ends its date.
 *
 * An end time at or before the start time means the shift ends the next day,
 * the same convention as `calculateNightHours` (so "08:00"-"08:00" is a 24 h
 * shift). A shift ending exactly at "00:00" ends at that midnight, not after
 * it. Rest days and malformed times never count, so a bad template falls back
 * to sending the reminder. Pure.
 *
 * @example
 * shiftRunsPastMidnight({ type: "night", startTime: "22:00", endTime: "06:00" }); // => true
 * shiftRunsPastMidnight({ type: "afternoon", startTime: "14:00", endTime: "22:00" }); // => false
 */
export function shiftRunsPastMidnight(shift: ScheduledShift): boolean {
  if (shift.type === "rest") return false;
  const start = minutesOfDay(shift.startTime);
  const end = minutesOfDay(shift.endTime);
  if (start === null || end === null) return false;
  return end <= start && end > 0;
}

/**
 * TIM-003: whether a session left open at the end of local day `date` is the
 * employee's rostered overnight shift, so it is expected to still be open and
 * is not a missing clock-out.
 *
 * True when the shift rostered for `date` runs past local midnight
 * (`shiftRunsPastMidnight`) and the open session started on `date` itself. A
 * session carried over from an earlier day is never covered, so a clock-out
 * forgotten after one night shift is still reported on the next day even if
 * that day is a night shift too. The next day's run then checks that the
 * shift was closed. Pure: no I/O, no clock.
 *
 * @example
 * coveredByOvernightShift(
 *   { state: "clocked_in", clockIn: "2026-11-02T21:00:00Z" },
 *   "2026-11-02",
 *   "Europe/Madrid",
 *   { type: "night", startTime: "22:00", endTime: "06:00" },
 * ); // => true
 */
export function coveredByOvernightShift(
  open: OpenAtDayEnd,
  date: string,
  timeZone: string,
  shift: ScheduledShift | null,
): boolean {
  if (!shift || !shiftRunsPastMidnight(shift)) return false;
  const dayStart = Temporal.PlainDate.from(date).toZonedDateTime(timeZone);
  return (
    Temporal.Instant.compare(
      Temporal.Instant.from(open.clockIn),
      dayStart.toInstant(),
    ) >= 0
  );
}
