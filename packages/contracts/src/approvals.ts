import { z } from "zod";
import { LeaveRequestSchema } from "./leave.js";
import { TimeCorrectionItemSchema } from "./time.js";

/** Most items of each kind the approvals inbox returns, oldest first. */
export const PENDING_APPROVALS_LIMIT = 200;

/**
 * A pending leave request in the inbox. `selfApproval` is true for the
 * caller's own request when nobody else could decide it (LEA-004 sole
 * approver exception): it may only be approved, and approving it requires a
 * non-empty `reason` (`DecideLeaveRequestSchema`).
 */
export const PendingLeaveApprovalSchema = LeaveRequestSchema.extend({
  selfApproval: z.boolean(),
});
export type PendingLeaveApproval = z.infer<typeof PendingLeaveApprovalSchema>;

/**
 * LEA-004 / LEA-008 / TIM-003: pending items the caller may decide right now.
 * Never includes the caller's own requests, except their own leave when they
 * are its only possible approver (`selfApproval`); empty for roles that
 * decide nothing (employees without an active delegation, auditors).
 */
export const PendingApprovalsSchema = z.object({
  leaveRequests: z
    .array(PendingLeaveApprovalSchema)
    .max(PENDING_APPROVALS_LIMIT),
  timeCorrections: z
    .array(TimeCorrectionItemSchema)
    .max(PENDING_APPROVALS_LIMIT),
  /** True when more items than the limit were waiting; the oldest are shown. */
  truncated: z.boolean(),
});
export type PendingApprovals = z.infer<typeof PendingApprovalsSchema>;
