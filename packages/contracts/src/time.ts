import { z } from "zod";
import { storableText } from "./common.js";

export const TimeEventTypeSchema = z.enum([
  "clock_in",
  "clock_out",
  "break_start",
  "break_end",
  "correction",
]);
export type TimeEventType = z.infer<typeof TimeEventTypeSchema>;

export const TimeEventSchema = z.object({
  id: z.string().uuid(),
  employeeId: z.string().uuid(),
  eventType: TimeEventTypeSchema,
  occurredAt: z.string().datetime(),
  recordedAt: z.string().datetime(),
  source: z.string(),
  actorId: z.string().uuid(),
  refEventId: z.string().uuid().nullable().optional(),
  reason: z.string().nullable().optional(),
  prevHash: z.string().nullable().optional(),
  hash: z.string(),
});
export type TimeEvent = z.infer<typeof TimeEventSchema>;

export const CreateScheduleAssignmentSchema = z.object({
  employeeId: z.string().uuid(),
  name: z.string().trim().min(1).max(100),
  effectiveFrom: z.string().date(),
  minimumDailyRestHours: z.number().min(0).max(24),
  rules: z
    .array(
      z.object({
        dayOfWeek: z.number().int().min(1).max(7),
        expectedHours: z.number().min(0).max(24),
        breakMinutes: z.number().int().min(0).max(1440),
      }),
    )
    .length(7)
    .refine(
      (rules) => new Set(rules.map((rule) => rule.dayOfWeek)).size === 7,
      "Configure each day exactly once",
    ),
});
export type CreateScheduleAssignment = z.infer<
  typeof CreateScheduleAssignmentSchema
>;

/**
 * Direct clock request. The event source is set by the server from the route,
 * never from the body, and `occurredAt`, when given, must be within the
 * server's clock tolerance; older punches go through a correction (TIM-003).
 * Strict, so a client that sends `source` is told so instead of being
 * silently ignored.
 */
export const ClockRequestSchema = z
  .object({
    eventType: z.enum(["clock_in", "clock_out", "break_start", "break_end"]),
    occurredAt: z.string().datetime().optional(),
    notes: storableText(z.string().max(500)).optional(),
  })
  .strict();
export type ClockRequest = z.infer<typeof ClockRequestSchema>;

export const KioskClockRequestSchema = z.object({
  identifier: z.string().min(1, "Identifier is required"),
  pin: z
    .string()
    .min(4, "PIN must have at least 4 digits")
    .max(8, "PIN cannot exceed 8 digits"),
  eventType: z.enum(["clock_in", "clock_out", "break_start", "break_end"]),
});
export type KioskClockRequest = z.infer<typeof KioskClockRequestSchema>;

export const KioskClockResponseSchema = z.object({
  success: z.boolean(),
  employeeName: z.string(),
  eventType: z.string(),
  occurredAt: z.string(),
  newStatus: z.enum(["clocked_in", "on_break", "clocked_out"]),
});
export type KioskClockResponse = z.infer<typeof KioskClockResponseSchema>;

export const SetEmployeePinSchema = z.object({
  pin: z.string().regex(/^\d{4,8}$/, "PIN must be 4 to 8 numeric digits"),
  badgeId: z.string().optional(),
});
export type SetEmployeePin = z.infer<typeof SetEmployeePinSchema>;

export const ClockStatusResponseSchema = z.object({
  status: z.enum(["clocked_in", "on_break", "clocked_out"]),
  lastEvent: TimeEventSchema.nullable(),
});
export type ClockStatusResponse = z.infer<typeof ClockStatusResponseSchema>;

export const BreakIntervalSchema = z.object({
  breakStart: z.string(),
  breakEnd: z.string().optional(),
  durationMinutes: z.number(),
});
export type BreakInterval = z.infer<typeof BreakIntervalSchema>;

export const WorkSessionSchema = z.object({
  clockIn: z.string(),
  clockOut: z.string().optional(),
  isOpen: z.boolean(),
  breaks: z.array(BreakIntervalSchema),
  grossDurationMinutes: z.number(),
  totalBreakMinutes: z.number(),
  netWorkedDurationMinutes: z.number(),
});
export type WorkSession = z.infer<typeof WorkSessionSchema>;

export const DayTimesheetSummarySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dayOfWeek: z.number().int().min(1).max(7),
  sessions: z.array(WorkSessionSchema),
  totalWorkedMinutes: z.number(),
  totalBreakMinutes: z.number(),
  expectedHours: z.number(),
  overtimeMinutes: z.number(),
  hasAnomaly: z.boolean(),
});
export type DayTimesheetSummary = z.infer<typeof DayTimesheetSummarySchema>;

export const PeriodTimesheetResponseSchema = z.object({
  days: z.array(DayTimesheetSummarySchema),
  totalWorkedMinutes: z.number(),
  totalBreakMinutes: z.number(),
  totalExpectedHours: z.number(),
  totalOvertimeMinutes: z.number(),
});
export type PeriodTimesheetResponse = z.infer<
  typeof PeriodTimesheetResponseSchema
>;

export const TimesheetQuerySchema = z.object({
  employeeId: z.string().uuid().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type TimesheetQuery = z.infer<typeof TimesheetQuerySchema>;

export const CreateTimeCorrectionSchema = z.object({
  refEventId: z.string().uuid().optional(),
  proposedEventType: TimeEventTypeSchema,
  proposedOccurredAt: z.string().datetime(),
  reason: storableText(
    z.string().min(5, "Reason is mandatory for audit trail"),
  ),
});
export type CreateTimeCorrection = z.infer<typeof CreateTimeCorrectionSchema>;

export const DecideTimeCorrectionSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  reason: storableText(z.string()).optional(),
});
export type DecideTimeCorrection = z.infer<typeof DecideTimeCorrectionSchema>;

export const TimeCorrectionItemSchema = z.object({
  id: z.string().uuid(),
  employeeId: z.string().uuid(),
  employeeName: z.string().optional(),
  refEventId: z.string().uuid().nullable().optional(),
  proposedEventType: TimeEventTypeSchema,
  proposedOccurredAt: z.string().datetime(),
  reason: z.string(),
  status: z.enum(["pending", "approved", "rejected"]),
  approverId: z.string().uuid().nullable().optional(),
  approverName: z.string().nullable().optional(),
  decidedAt: z.string().datetime().nullable().optional(),
  decisionReason: z.string().nullable().optional(),
  createdEventId: z.string().uuid().nullable().optional(),
  createdAt: z.string().datetime(),
});
export type TimeCorrectionItem = z.infer<typeof TimeCorrectionItemSchema>;

/** Longest period one Labour Inspectorate export may cover (a leap year). */
export const OFFICIAL_EXPORT_MAX_DAYS = 366;

/**
 * Largest organization export, in employees × days of the period. A bigger
 * request is answered with 422 `EXPORT_TOO_LARGE` instead of being computed
 * in one request (about 136 employees for a full year, or 1,600 for a month).
 */
export const OFFICIAL_EXPORT_MAX_EMPLOYEE_DAYS = 50_000;

const DAY_MS = 86_400_000;

/** Inclusive number of calendar days between two valid `YYYY-MM-DD` dates. */
function inclusiveDays(startDate: string, endDate: string): number {
  // Both are plain calendar dates, so UTC midnights differ by whole days.
  return (Date.parse(endDate) - Date.parse(startDate)) / DAY_MS + 1;
}

/** Export period rule: end on or after start, at most 366 days. */
function refineExportPeriod(
  value: { startDate: string; endDate: string },
  ctx: z.RefinementCtx,
): void {
  if (value.endDate < value.startDate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endDate"],
      message: "endDate must be on or after startDate",
    });
  } else if (
    inclusiveDays(value.startDate, value.endDate) > OFFICIAL_EXPORT_MAX_DAYS
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endDate"],
      message: `The period cannot exceed ${OFFICIAL_EXPORT_MAX_DAYS} days`,
    });
  }
}

/**
 * TIM-006 Labour Inspectorate export query. `employeeId` only applies to the
 * employee scope (default: the caller's own employee record).
 */
export const OfficialExportQuerySchema = z
  .object({
    format: z.enum(["json", "csv", "pdf"]).default("json"),
    scope: z.enum(["employee", "organization"]).default("employee"),
    employeeId: z.string().uuid().optional(),
    startDate: z.string().date(),
    endDate: z.string().date(),
    locale: z.enum(["ca", "es", "en"]).default("es"),
  })
  .superRefine((value, ctx) => {
    if (value.scope === "organization" && value.employeeId !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["employeeId"],
        message: "employeeId is only allowed with scope=employee",
      });
    }
    refineExportPeriod(value, ctx);
  });
export type OfficialExportQuery = z.input<typeof OfficialExportQuerySchema>;

/**
 * TIM-006/TIM-008 employee picker of the export: the period whose employees
 * may be exported, with the same rule as the export itself.
 */
export const ExportEmployeesQuerySchema = z
  .object({
    startDate: z.string().date(),
    endDate: z.string().date(),
  })
  .superRefine(refineExportPeriod);
export type ExportEmployeesQuery = z.input<typeof ExportEmployeesQuerySchema>;

/**
 * Employees the caller may export for the period, sorted by name. Id and
 * display name only (data minimisation).
 */
export const ExportEmployeesResponseSchema = z.object({
  items: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string(),
    }),
  ),
});
export type ExportEmployeesResponse = z.infer<
  typeof ExportEmployeesResponseSchema
>;

/** TIM-002 chain verification result of one employee's records. */
export const ChainStatusSchema = z.enum([
  "verified",
  "tampered",
  "legacy_only",
  "empty",
]);
export type ChainStatus = z.infer<typeof ChainStatusSchema>;

/**
 * JSON form of the TIM-006 export. `rows` holds the same display cells as the
 * CSV (in `columns` order); `contentHash` is the SHA-256 of the CSV body.
 */
export const OfficialExportResponseSchema = z.object({
  exportId: z.string().uuid(),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  scope: z.enum(["employee", "organization"]),
  locale: z.enum(["ca", "es", "en"]),
  periodStart: z.string().date(),
  periodEnd: z.string().date(),
  /** The organization's zone (header). Each employee has their own below. */
  timeZone: z.string(),
  generatedAt: z.string().datetime(),
  organizationName: z.string(),
  generatedBy: z.object({ name: z.string(), role: z.string() }),
  metadataLines: z.array(z.string()),
  columns: z.array(z.string()),
  rows: z.array(z.array(z.string())),
  /**
   * One entry per row of `rows`, same order: whether that day falls inside
   * one of the employee's employment periods (null on a "schedule not
   * configured" row). The same flag is the last display cell of each row; a
   * day outside employment expects 0 minutes but still lists recorded work.
   */
  rowsEmployed: z.array(z.boolean().nullable()),
  employees: z.array(
    z.object({
      employeeId: z.string().uuid(),
      name: z.string(),
      /** IANA zone of this employee's days and times (location, else organization). */
      timeZone: z.string(),
      scheduleConfigured: z.boolean(),
      chainStatus: ChainStatusSchema.nullable(),
      /** Null when the schedule is not configured (no days computed). */
      totalWorkedMinutes: z.number().nullable(),
      totalOvertimeMinutes: z.number().nullable(),
    }),
  ),
});
export type OfficialExportResponse = z.infer<
  typeof OfficialExportResponseSchema
>;

export const TimeBankRecordSchema = z.object({
  id: z.string().uuid(),
  employeeId: z.string().uuid(),
  type: z.enum([
    "overtime_accrual",
    "compensatory_rest_taken",
    "manual_adjustment",
    "expired",
  ]),
  minutes: z.number().int(),
  referenceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().nullable().optional(),
  createdAt: z.string(),
});
export type TimeBankRecord = z.infer<typeof TimeBankRecordSchema>;

export const TimeBankSummarySchema = z.object({
  totalAccruedMinutes: z.number(),
  totalCompensatedMinutes: z.number(),
  currentBalanceMinutes: z.number(),
  currentBalanceHoursFormatted: z.string(),
  records: z.array(TimeBankRecordSchema),
});
export type TimeBankSummary = z.infer<typeof TimeBankSummarySchema>;

export const CreateTimeBankEntrySchema = z.object({
  employeeId: z.string().uuid(),
  type: z.enum([
    "overtime_accrual",
    "compensatory_rest_taken",
    "manual_adjustment",
    "expired",
  ]),
  minutes: z.number().int(),
  referenceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().optional(),
});
export type CreateTimeBankEntry = z.infer<typeof CreateTimeBankEntrySchema>;
