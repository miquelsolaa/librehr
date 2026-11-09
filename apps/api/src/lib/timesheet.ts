import type { Context } from "hono";
import {
  buildLocalPeriodTimesheet,
  foldSessions,
  type LocalPeriodTimesheetResult,
} from "@librehr/core";
import {
  ScheduleRepository,
  TimeRepository,
  type TenantTx,
  type TimeEventRow,
} from "@librehr/db";
import { resolveBusinessTimeZone } from "./business-date.js";

const timeRepo = new TimeRepository();
const scheduleRepo = new ScheduleRepository();

/** Folds stored time events into work sessions (corrections applied). */
export function foldRecordedEvents(events: readonly TimeEventRow[]) {
  return foldSessions(
    events.map((event) => ({
      id: event.id,
      organizationId: event.organizationId,
      employeeId: event.employeeId,
      eventType: event.eventType as
        "clock_in" | "clock_out" | "break_start" | "break_end" | "correction",
      occurredAt: event.occurredAt.toISOString(),
      recordedAt: event.recordedAt.toISOString(),
      source: event.source as "web" | "mobile" | "kiosk" | "manual" | "import",
      actorId: event.actorId,
      ...(event.refEventId ? { refEventId: event.refEventId } : {}),
      hash: event.hash,
      prevHash: event.prevHash,
    })),
  );
}

export interface TimesheetArgs {
  employeeId: string;
  locationId: string | null;
  startDate: string;
  endDate: string;
  /**
   * Zone whose midnights bound each day. Defaults to the employee's business
   * zone (location, else organization).
   */
  timeZone?: string | undefined;
}

export interface LoadedTimesheet {
  timesheet: LocalPeriodTimesheetResult;
  /** Every stored event of the employee, ordered by `occurred_at`. */
  events: TimeEventRow[];
  timeZone: string;
}

/**
 * TIM-004/TIM-005: one events query and one schedule query for the whole
 * period; core splits work into local days (local midnight to local
 * midnight, so 23 or 25 hours across DST) and resolves each day's schedule.
 * The events are returned too, so callers that also need them (exports) do
 * not query them twice.
 */
export async function buildTimesheet(
  c: Context,
  tx: TenantTx,
  args: TimesheetArgs,
): Promise<LoadedTimesheet> {
  const timeZone =
    args.timeZone ?? (await resolveBusinessTimeZone(c, tx, args.locationId));
  // Include the enclosing session when it starts or ends outside the period.
  const events = await timeRepo.getEventsForEmployee(tx, args.employeeId);
  const schedules = await scheduleRepo.getScheduleSpansForEmployee(
    tx,
    args.employeeId,
    args.startDate,
    args.endDate,
  );
  const timesheet = buildLocalPeriodTimesheet({
    startDate: args.startDate,
    endDate: args.endDate,
    timeZone,
    sessions: foldRecordedEvents(events),
    schedules,
  });
  return { timesheet, events, timeZone };
}
