import {
  datesInRange,
  isBeforeDate,
  isoDayOfWeek,
} from "../calendar/business-date.js";
import type { WorkSession } from "./fold-sessions.js";
import { splitSessionsByLocalDay } from "./local-day-sessions.js";
import type { ScheduleRule } from "./schedules.js";
import {
  calculateDailyTimesheet,
  calculatePeriodTimesheet,
  type DayTimesheetSummary,
  type PeriodTimesheetSummary,
} from "./timesheet-calculator.js";

/**
 * A schedule that applies to an employee over a span of calendar days. The
 * organization default schedule (`isDefault`) has no bounds and applies to
 * any day not covered by an explicit assignment.
 */
export interface ScheduleSpan {
  isDefault: boolean;
  /** First day (inclusive); null for the organization default. */
  effectiveFrom: string | null;
  /** Last day (inclusive); null when open-ended. */
  effectiveTo: string | null;
  rules: readonly Pick<ScheduleRule, "dayOfWeek" | "expectedHours">[];
}

/**
 * The schedule in force on a calendar date: the explicit assignment with the
 * latest start covering the date, else the organization default, else null.
 *
 * @example
 * resolveScheduleForDate(
 *   [{ isDefault: false, effectiveFrom: "2026-01-01", effectiveTo: null, rules: [] }],
 *   "2026-03-29",
 * ); // => the 2026-01-01 span
 */
export function resolveScheduleForDate(
  spans: readonly ScheduleSpan[],
  date: string,
): ScheduleSpan | null {
  let best: ScheduleSpan | null = null;
  for (const span of spans) {
    if (span.isDefault || span.effectiveFrom === null) continue;
    if (isBeforeDate(date, span.effectiveFrom)) continue;
    if (span.effectiveTo !== null && isBeforeDate(span.effectiveTo, date))
      continue;
    if (
      best?.effectiveFrom == null ||
      isBeforeDate(best.effectiveFrom, span.effectiveFrom)
    ) {
      best = span;
    }
  }
  return best ?? spans.find((span) => span.isDefault) ?? null;
}

export type LocalPeriodTimesheetResult =
  | { ok: true; days: DayTimesheetSummary[]; summary: PeriodTimesheetSummary }
  | { ok: false; reason: "SCHEDULE_NOT_CONFIGURED"; date: string };

export interface LocalPeriodTimesheetInput {
  startDate: string;
  endDate: string;
  /** IANA zone whose midnights bound each day (location, else organization). */
  timeZone: string;
  sessions: readonly WorkSession[];
  /** Every schedule span that may cover the period, fetched once. */
  schedules: readonly ScheduleSpan[];
}

/**
 * Builds a timesheet for a period of local calendar days (TIM-004/TIM-005).
 * Each day runs from local midnight to the next local midnight, so a daylight
 * saving day is 23 or 25 hours long and work is counted by real elapsed time.
 * Expected hours come from the schedule in force on each day; a day with no
 * schedule at all makes the whole period unconfigured.
 *
 * @example
 * buildLocalPeriodTimesheet({
 *   startDate: "2026-03-29",
 *   endDate: "2026-03-29",
 *   timeZone: "Europe/Madrid",
 *   sessions: [],
 *   schedules: [{ isDefault: true, effectiveFrom: null, effectiveTo: null, rules: [] }],
 * }); // => { ok: true, days: [{ date: "2026-03-29", expectedHours: 0, ... }], ... }
 */
export function buildLocalPeriodTimesheet(
  input: LocalPeriodTimesheetInput,
): LocalPeriodTimesheetResult {
  const sessionsByDay = splitSessionsByLocalDay(
    input.sessions,
    input.startDate,
    input.endDate,
    input.timeZone,
  );
  const days: DayTimesheetSummary[] = [];
  for (const date of datesInRange(input.startDate, input.endDate)) {
    const schedule = resolveScheduleForDate(input.schedules, date);
    if (!schedule) {
      return { ok: false, reason: "SCHEDULE_NOT_CONFIGURED", date };
    }
    const dayOfWeek = isoDayOfWeek(date);
    const rule = schedule.rules.find((item) => item.dayOfWeek === dayOfWeek);
    days.push(
      calculateDailyTimesheet(date, sessionsByDay.get(date) ?? [], {
        dayOfWeek,
        expectedHours: rule?.expectedHours ?? 0,
      }),
    );
  }
  return { ok: true, days, summary: calculatePeriodTimesheet(days) };
}
