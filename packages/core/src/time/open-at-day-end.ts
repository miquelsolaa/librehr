import { Temporal } from "temporal-polyfill";
import type { TimeEvent } from "./events.js";
import { resolveCorrections } from "./resolve-corrections.js";

export type OpenDayState = "clocked_in" | "on_break";

export interface OpenAtDayEnd {
  /** What the employee's last event of the day left open. */
  state: OpenDayState;
  /** When the still-open session started (ISO 8601 UTC). */
  clockIn: string;
}

/**
 * TIM-003: whether an employee's effective events leave them clocked in or on
 * a break at the end of local day `date` in `timeZone` (a missing clock-out).
 *
 * Corrections replace the events they reference first (`resolveCorrections`).
 * The day runs from local midnight to the next local midnight, so it lasts 23
 * or 25 hours on DST change days. A clock-out exactly at the closing midnight
 * still closes the day. Returns null when:
 * - no effective event falls on that day (an older open session was the
 *   previous day's to report), or
 * - the session is closed, including by a clock-out recorded after midnight
 *   (a night shift that ends the next day is not a missing clock-out).
 *
 * Pass events from before the day too, so a session opened the day before is
 * known. Pure: no I/O, no clock.
 *
 * @example
 * openAtDayEnd(
 *   [{ id: "a", eventType: "clock_in", occurredAt: "2026-11-02T08:00:00Z", ... }],
 *   "2026-11-02",
 *   "Europe/Madrid",
 * ); // => { state: "clocked_in", clockIn: "2026-11-02T08:00:00Z" }
 */
export function openAtDayEnd(
  events: readonly TimeEvent[],
  date: string,
  timeZone: string,
): OpenAtDayEnd | null {
  const day = Temporal.PlainDate.from(date);
  const start = day.toZonedDateTime(timeZone).epochMilliseconds;
  const end = day.add({ days: 1 }).toZonedDateTime(timeZone).epochMilliseconds;

  // Stable sort: same-instant events keep their stored (seq) order.
  const effective = resolveCorrections(events)
    .map((event) => ({ event, at: Date.parse(event.occurredAt) }))
    .sort((a, b) => a.at - b.at);

  let state: OpenDayState | null = null;
  let clockIn: string | null = null;
  let eventsOnDay = 0;
  let index = 0;
  for (; index < effective.length; index++) {
    const { event, at } = effective[index]!;
    const inDay = at < end || (at === end && event.eventType === "clock_out");
    if (!inDay) break;
    if (at >= start) eventsOnDay++;
    switch (event.eventType) {
      case "clock_in":
        state = "clocked_in";
        clockIn = event.occurredAt;
        break;
      case "break_start":
        if (state === "clocked_in") state = "on_break";
        break;
      case "break_end":
        if (state === "on_break") state = "clocked_in";
        break;
      case "clock_out":
        state = null;
        clockIn = null;
        break;
      case "correction":
        break;
    }
  }
  if (state === null || clockIn === null || eventsOnDay === 0) return null;

  // The first later clock-in or clock-out decides: a clock-out closes the
  // night shift; a new clock-in means this session was never closed.
  for (; index < effective.length; index++) {
    const type = effective[index]!.event.eventType;
    if (type === "clock_out") return null;
    if (type === "clock_in") break;
  }
  return { state, clockIn };
}
