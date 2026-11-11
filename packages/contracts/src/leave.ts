import { z } from "zod";

export const LeaveTypeSchema = z.object({
  id: z.guid(),
  name: z.string(),
  code: z.string(),
  isPaid: z.boolean(),
  requiresApproval: z.boolean(),
  requiresAttachment: z.boolean().default(false),
  legalReference: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  halfDaysAllowed: z.boolean(),
  countsWorkingDays: z.boolean(),
  color: z.string(),
});
export type LeaveType = z.infer<typeof LeaveTypeSchema>;

export const CreateLeaveTypeRequestSchema = z.object({
  name: z.string().min(1, "Name is required"),
  code: z.string().min(1, "Code is required"),
  isPaid: z.boolean().default(true),
  requiresApproval: z.boolean().default(true),
  requiresAttachment: z.boolean().default(false),
  legalReference: z.string().optional(),
  description: z.string().optional(),
  halfDaysAllowed: z.boolean().default(true),
  countsWorkingDays: z.boolean().default(true),
  color: z.string().default("#3b82f6"),
});
export type CreateLeaveTypeRequest = z.infer<
  typeof CreateLeaveTypeRequestSchema
>;

export const LeavePolicySchema = z.object({
  id: z.guid(),
  leaveTypeId: z.guid(),
  name: z.string(),
  annualAllowanceDays: z.number(),
  accrualMethod: z.enum(["upfront", "monthly", "daily"]),
  carryoverMaxDays: z.number(),
  carryoverExpiryMonths: z.number(),
  allowNegativeBalance: z.boolean(),
});
export type LeavePolicy = z.infer<typeof LeavePolicySchema>;

export const LeaveLedgerEntrySchema = z.object({
  id: z.guid(),
  employeeId: z.guid(),
  entryType: z.string(),
  amount: z.number(),
  unit: z.string(),
  sourceRef: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  effectiveDate: z.string(),
  createdAt: z.string().datetime(),
  /** Balance once this entry is applied. Present in the balance history. */
  balanceAfter: z.number().optional(),
});
export type LeaveLedgerEntry = z.infer<typeof LeaveLedgerEntrySchema>;

export const LeaveBalanceSummarySchema = z.object({
  currentBalance: z.number(),
  totalAccrued: z.number(),
  totalUsed: z.number(),
  totalCarryover: z.number(),
  totalAdjustments: z.number(),
  entries: z.array(LeaveLedgerEntrySchema),
});
export type LeaveBalanceSummary = z.infer<typeof LeaveBalanceSummarySchema>;

export const LeaveRequestStatusSchema = z.enum([
  "pending",
  "approved",
  "rejected",
  "cancelled",
]);
export type LeaveRequestStatus = z.infer<typeof LeaveRequestStatusSchema>;

export const LeaveRequestSchema = z.object({
  id: z.guid(),
  employeeId: z.guid(),
  employeeName: z.string().optional(),
  leaveTypeId: z.guid(),
  leaveTypeName: z.string().optional(),
  leaveTypeCode: z.string().optional(),
  leaveTypeColor: z.string().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  halfDayStart: z.boolean(),
  halfDayEnd: z.boolean(),
  workingDays: z.number(),
  status: LeaveRequestStatusSchema,
  notes: z.string().nullable().optional(),
  approverId: z.guid().nullable().optional(),
  approverName: z.string().nullable().optional(),
  decidedAt: z.string().datetime().nullable().optional(),
  decisionReason: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
});
export type LeaveRequest = z.infer<typeof LeaveRequestSchema>;

export const CreateLeaveRequestSchema = z.object({
  employeeId: z.guid().optional(), // HR can specify on behalf (LEA-010)
  leaveTypeId: z.guid(),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Format must be YYYY-MM-DD"),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format must be YYYY-MM-DD"),
  halfDayStart: z.boolean().default(false),
  halfDayEnd: z.boolean().default(false),
  notes: z.string().optional(),
});
export type CreateLeaveRequest = z.infer<typeof CreateLeaveRequestSchema>;

export const DecideLeaveRequestSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  reason: z.string().optional(),
});
export type DecideLeaveRequest = z.infer<typeof DecideLeaveRequestSchema>;

export const AdjustBalanceRequestSchema = z.object({
  employeeId: z.guid(),
  amount: z.number(),
  note: z.string().min(3, "Mandatory reason for audit trail is required"),
  effectiveDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
export type AdjustBalanceRequest = z.infer<typeof AdjustBalanceRequestSchema>;

export const HolidaySchema = z.object({
  id: z.guid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  name: z.string(),
  scope: z.string(),
});
export type Holiday = z.infer<typeof HolidaySchema>;

export const ListHolidaysQuerySchema = z.object({
  locationId: z.guid(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});
export type ListHolidaysQuery = z.infer<typeof ListHolidaysQuerySchema>;

export const TeamAbsencesQuerySchema = z.object({
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  departmentId: z.guid().optional(),
});
export type TeamAbsencesQuery = z.infer<typeof TeamAbsencesQuerySchema>;

export const CreateHolidayRequestSchema = z.object({
  locationId: z.guid(),
  year: z.number().int().min(2000).max(2100).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  name: z.string().min(1).max(100),
  scope: z.enum(["national", "regional", "local", "company"]).default("local"),
});
export type CreateHolidayRequest = z.infer<typeof CreateHolidayRequestSchema>;

export const SeedStatutoryHolidaysRequestSchema = z.object({
  locationId: z.guid(),
  year: z.number().int().min(2000).max(2100),
  region: z.string().optional(),
  city: z.string().optional(),
});
export type SeedStatutoryHolidaysRequest = z.infer<
  typeof SeedStatutoryHolidaysRequestSchema
>;

export const TeamAbsenceSchema = z.object({
  requestId: z.guid(),
  employeeId: z.guid(),
  employeeName: z.string(),
  departmentId: z.guid().nullable().optional(),
  departmentName: z.string().nullable().optional(),
  startDate: z.string(),
  endDate: z.string(),
  halfDayStart: z.boolean(),
  halfDayEnd: z.boolean(),
  leaveTypeCode: z.string(),
  leaveTypeName: z.string(),
  status: z.string(),
});
export type TeamAbsence = z.infer<typeof TeamAbsenceSchema>;

// LEA-007: Blackout Periods
export const BlackoutPeriodSchema = z.object({
  id: z.guid(),
  departmentId: z.guid().nullable().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string(),
  createdAt: z.string(),
});
export type BlackoutPeriod = z.infer<typeof BlackoutPeriodSchema>;

export const CreateBlackoutPeriodSchema = z.object({
  departmentId: z.guid().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
  reason: z.string().min(3, "Reason is mandatory"),
});
export type CreateBlackoutPeriod = z.infer<typeof CreateBlackoutPeriodSchema>;

// LEA-008: Approval Delegations
export const ApprovalDelegationSchema = z.object({
  id: z.guid(),
  managerEmployeeId: z.guid(),
  delegateEmployeeId: z.guid(),
  managerName: z.string().optional(),
  delegateName: z.string().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().nullable().optional(),
  createdAt: z.string(),
});
export type ApprovalDelegation = z.infer<typeof ApprovalDelegationSchema>;

export const CreateApprovalDelegationSchema = z.object({
  delegateEmployeeId: z.guid(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
  reason: z.string().optional(),
});
export type CreateApprovalDelegation = z.infer<
  typeof CreateApprovalDelegationSchema
>;
