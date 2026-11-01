import { z } from "zod";

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

export const ClockRequestSchema = z.object({
  eventType: z.enum(["clock_in", "clock_out", "break_start", "break_end"]),
  occurredAt: z.string().datetime().optional(),
  source: z.enum(["web", "mobile"]).default("web"),
  notes: z.string().optional(),
});
export type ClockRequest = z.infer<typeof ClockRequestSchema>;

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
  reason: z.string().min(5, "Reason is mandatory for audit trail"),
});
export type CreateTimeCorrection = z.infer<typeof CreateTimeCorrectionSchema>;

export const DecideTimeCorrectionSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  reason: z.string().optional(),
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

export const OfficialExportResponseSchema = z.object({
  metadata: z.object({
    organizationId: z.string().uuid(),
    organizationName: z.string(),
    employeeId: z.string().uuid(),
    employeeName: z.string(),
    periodStart: z.string(),
    periodEnd: z.string(),
    generatedAt: z.string(),
    generatorActorId: z.string(),
  }),
  days: z.array(DayTimesheetSummarySchema),
  totalWorkedMinutes: z.number(),
  totalOvertimeMinutes: z.number(),
  documentContentHash: z.string(),
});
export type OfficialExportResponse = z.infer<
  typeof OfficialExportResponseSchema
>;
