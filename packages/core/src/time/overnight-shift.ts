import { Temporal } from "temporal-polyfill";
import type { TimeEvent } from "./events.js";
import { foldToDayEnd, type OpenAtDayEnd } from "./open-at-day-end.js";

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
 * (`shiftRunsPastMidnight`) and the open session started on `date` at or
 * after the shift's end time (e.g. 06:00 for a 22:00-06:00 shift). Earlier
 * clock-ins on `date` belong to the previous night's shift, and sessions
 * carried over from an earlier day are never covered, so a clock-out
 * forgotten after one night shift is still reported even if the next day is
 * a night shift too. A covered session that is still open a day later is
 * reported by `overnightStillOpenAtDayEnd` on the next day's run.
 *
 * Known limits: any clock-in from the shift's end time on is covered (a
 * tighter window around the rostered start would need a configurable grace
 * period); a shift rostered to start at 00:00 on the next day does not cover
 * an early clock-in before midnight. Pure: no I/O, no clock.
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
  const day = Temporal.PlainDate.from(date);
  // shiftRunsPastMidnight validated endTime as "HH:mm".
  const earliest = day.toZonedDateTime({
    timeZone,
    plainTime: Temporal.PlainTime.from(shift.endTime),
  });
  const nextDay = day.add({ days: 1 }).toZonedDateTime(timeZone);
  const clockIn = Temporal.Instant.from(open.clockIn);
  return (
    Temporal.Instant.compare(clockIn, earliest.toInstant()) >= 0 &&
    Temporal.Instant.compare(clockIn, nextDay.toInstant()) < 0
  );
}

/**
 * TIM-003: the session an overnight shift left open, when it is still open at
 * the end of local day `date`, the day after the shift's rostered date.
 *
 * The run for the rostered date skips a session covered by
 * `coveredByOvernightShift`; this is the check that the shift was closed
 * afterwards. It does not need an event on `date` (`openAtDayEnd` does), so a
 * night worker who never punches again is still reminded, one day late.
 * Returns null when `previousDayShift` (the shift rostered for the day before
 * `date`) does not run past midnight, when the session was closed, or when
 * the open session is not the one that shift covered. Pure: no I/O, no clock.
 *
 * @example
 * overnightStillOpenAtDayEnd(
 *   [{ id: "a", eventType: "clock_in", occurredAt: "2026-11-02T21:00:00Z", ... }],
 *   "2026-11-03",
 *   "Europe/Madrid",
 *   { type: "night", startTime: "22:00", endTime: "06:00" },
 * ); // => { state: "clocked_in", clockIn: "2026-11-02T21:00:00Z" }
 */
export function overnightStillOpenAtDayEnd(
  events: readonly TimeEvent[],
  date: string,
  timeZone: string,
  previousDayShift: ScheduledShift | null,
): OpenAtDayEnd | null {
  if (!previousDayShift || !shiftRunsPastMidnight(previousDayShift)) {
    return null;
  }
  const { open } = foldToDayEnd(events, date, timeZone);
  if (!open) return null;
  const previousDay = Temporal.PlainDate.from(date)
    .subtract({ days: 1 })
    .toString();
  return coveredByOvernightShift(open, previousDay, timeZone, previousDayShift)
    ? open
    : null;
}
