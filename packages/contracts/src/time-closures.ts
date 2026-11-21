import { z } from "zod";
import { storableText } from "./common.js";

/**
 * TIM-004 (#31): monthly timesheet closure. A closed month keeps a snapshot
 * of its totals; time events added to it afterwards are flagged, never
 * blocked.
 */

/** A calendar month, `YYYY-MM`. */
export const ClosureMonthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Month must be YYYY-MM");

/** Totals of the month's timesheet frozen at closing time. */
export const TimesheetClosureTotalsSchema = z.object({
  totalWorkedMinutes: z.number(),
  totalBreakMinutes: z.number(),
  totalExpectedHours: z.number(),
  totalOvertimeMinutes: z.number(),
});
export type TimesheetClosureTotals = z.infer<
  typeof TimesheetClosureTotalsSchema
>;

/** A time event recorded in a closed month after it was closed. */
export const PostCloseChangeSchema = z.object({
  eventId: z.guid(),
  /** The event it corrects, when it is a correction. */
  refEventId: z.guid().nullable(),
  createdAt: z.string().datetime(),
});
export type PostCloseChange = z.infer<typeof PostCloseChangeSchema>;

/**
 * Closure state attached to `GET /time/timesheet` when the requested range
 * lies within one calendar month that is currently closed for the employee.
 * `postCloseChanges` covers the whole month, not only the requested range.
 */
export const TimesheetClosureInfoSchema = z.object({
  closedAt: z.string().datetime(),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  totals: TimesheetClosureTotalsSchema,
  postCloseChanges: z.array(PostCloseChangeSchema),
});
export type TimesheetClosureInfo = z.infer<typeof TimesheetClosureInfoSchema>;

export const CloseTimesheetPeriodRequestSchema = z.object({
  month: ClosureMonthSchema,
  /** Defaults to every employee in scope employed during the month. */
  employeeIds: z.array(z.guid()).min(1).max(1000).optional(),
});
export type CloseTimesheetPeriodRequest = z.infer<
  typeof CloseTimesheetPeriodRequestSchema
>;

export const CloseTimesheetPeriodResultSchema = z.object({
  employeeId: z.guid(),
  status: z.enum(["closed", "already_closed", "schedule_not_configured"]),
  /** When the month was closed (now, or the earlier close it kept). */
  closedAt: z.string().datetime().nullable(),
});
export type CloseTimesheetPeriodResult = z.infer<
  typeof CloseTimesheetPeriodResultSchema
>;

export const CloseTimesheetPeriodResponseSchema = z.object({
  month: ClosureMonthSchema,
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  results: z.array(CloseTimesheetPeriodResultSchema),
});
export type CloseTimesheetPeriodResponse = z.infer<
  typeof CloseTimesheetPeriodResponseSchema
>;

export const ReopenTimesheetPeriodRequestSchema = z.object({
  month: ClosureMonthSchema,
  employeeId: z.guid(),
  reason: storableText(
    z.string().trim().min(5, "A reason is required to reopen").max(1000),
  ),
});
export type ReopenTimesheetPeriodRequest = z.infer<
  typeof ReopenTimesheetPeriodRequestSchema
>;

export const TimesheetClosuresQuerySchema = z.object({
  month: ClosureMonthSchema,
});
export type TimesheetClosuresQuery = z.infer<
  typeof TimesheetClosuresQuerySchema
>;

/** Current state (newest close or reopen) of one employee's month. */
export const TimesheetClosureItemSchema = z.object({
  employeeId: z.guid(),
  employeeName: z.string(),
  status: z.enum(["closed", "reopened"]),
  /** When the newest close or reopen was recorded. */
  at: z.string().datetime(),
  actorId: z.guid(),
  /** Frozen totals when closed; null when reopened. */
  totals: TimesheetClosureTotalsSchema.nullable(),
  /** Reopen reason; null when closed. */
  reason: z.string().nullable(),
});
export type TimesheetClosureItem = z.infer<typeof TimesheetClosureItemSchema>;

export const TimesheetClosuresResponseSchema = z.object({
  month: ClosureMonthSchema,
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  items: z.array(TimesheetClosureItemSchema),
});
export type TimesheetClosuresResponse = z.infer<
  typeof TimesheetClosuresResponseSchema
>;
