import { z } from "zod";
import { LeaveRequestSchema } from "./leave.js";
import { TimeCorrectionItemSchema } from "./time.js";

/** Most items of each kind the approvals inbox returns, oldest first. */
export const PENDING_APPROVALS_LIMIT = 200;

/**
 * LEA-004 / LEA-008 / TIM-003: pending items the caller may decide right now.
 * Never includes the caller's own requests; empty for roles that decide
 * nothing (employees without an active delegation, auditors).
 */
export const PendingApprovalsSchema = z.object({
  leaveRequests: z.array(LeaveRequestSchema).max(PENDING_APPROVALS_LIMIT),
  timeCorrections: z
    .array(TimeCorrectionItemSchema)
    .max(PENDING_APPROVALS_LIMIT),
  /** True when more items than the limit were waiting; the oldest are shown. */
  truncated: z.boolean(),
});
export type PendingApprovals = z.infer<typeof PendingApprovalsSchema>;
