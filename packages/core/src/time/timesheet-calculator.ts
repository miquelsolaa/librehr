import { isoDayOfWeek } from "../calendar/business-date.js";
import type { WorkSession } from "./fold-sessions.js";
import type { ScheduleRule } from "./schedules.js";

export interface DayTimesheetSummary {
  date: string; // YYYY-MM-DD
  dayOfWeek: number; // 1-7
  sessions: WorkSession[];
  totalWorkedMinutes: number;
  totalBreakMinutes: number;
  expectedHours: number;
  overtimeMinutes: number; // positive = overtime, negative = undertime
  hasAnomaly: boolean; // e.g. open session, rest period violation
}

export interface PeriodTimesheetSummary {
  days: DayTimesheetSummary[];
  totalWorkedMinutes: number;
  totalBreakMinutes: number;
  totalExpectedHours: number;
  totalOvertimeMinutes: number;
}

/**
 * Aggregates folded sessions and matches them against daily schedule rules.
 */
export function calculateDailyTimesheet(
  date: string,
  sessions: WorkSession[],
  scheduleRule?: ScheduleRule,
): DayTimesheetSummary {
  const dayOfWeek = isoDayOfWeek(date);
  let totalWorkedMinutes = 0;
  let totalBreakMinutes = 0;
  let hasAnomaly = false;

  for (const s of sessions) {
    if (s.isOpen) {
      hasAnomaly = true;
    }
    totalWorkedMinutes += s.netWorkedDurationMinutes;
    totalBreakMinutes += s.totalBreakMinutes;
  }

  if (!scheduleRule) throw new Error("Schedule rule is required");
  const expectedHours = scheduleRule.expectedHours;
  const expectedMinutes = Math.round(expectedHours * 60);
  const overtimeMinutes = totalWorkedMinutes - expectedMinutes;

  return {
    date,
    dayOfWeek,
    sessions,
    totalWorkedMinutes,
    totalBreakMinutes,
    expectedHours,
    overtimeMinutes,
    hasAnomaly,
  };
}

/**
 * Summarizes timesheet data for a pay period or calendar month.
 */
export function calculatePeriodTimesheet(
  dailySummaries: DayTimesheetSummary[],
): PeriodTimesheetSummary {
  let totalWorkedMinutes = 0;
  let totalBreakMinutes = 0;
  let totalExpectedHours = 0;
  let totalOvertimeMinutes = 0;

  for (const day of dailySummaries) {
    totalWorkedMinutes += day.totalWorkedMinutes;
    totalBreakMinutes += day.totalBreakMinutes;
    totalExpectedHours += day.expectedHours;
    totalOvertimeMinutes += day.overtimeMinutes;
  }

  return {
    days: dailySummaries,
    totalWorkedMinutes,
    totalBreakMinutes,
    totalExpectedHours,
    totalOvertimeMinutes,
  };
}
