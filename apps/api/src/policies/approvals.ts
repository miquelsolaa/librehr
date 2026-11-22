import { ROLE_PERMISSIONS, type Scope } from "@librehr/contracts";
import {
  LeaveRepository,
  type LeaveDeciderCandidate,
  type TenantTx,
} from "@librehr/db";
import { SelfApprovalForbiddenError } from "../errors/index.js";
import type { PolicyUserContext } from "./can.js";
import { canOnEmployee, type ScopedEmployee } from "./context.js";

/** The person a leave request or time correction belongs to. */
export interface ApprovalSubject {
  employeeId: string;
  /** User account linked to that employee, if any. */
  userId: string | null;
}

/** Whether the caller is the subject of the request being decided. */
export function isOwnRequest(
  ctx: PolicyUserContext,
  subject: ApprovalSubject,
): boolean {
  return (
    (Boolean(ctx.employeeId) && ctx.employeeId === subject.employeeId) ||
    (subject.userId !== null && subject.userId === ctx.userId)
  );
}

/**
 * LEA-004 / TIM-003 / TIM-005: nobody decides (approves or rejects) their own
 * leave request, time correction or shift swap, whatever their role or scope. Managers were
 * already blocked through `NOT_SELF_APPROVABLE` in `can.ts`; this extends the
 * rule to organization-scoped approvers (admins) and to LEA-008 delegates.
 *
 * One exception, for leave only: when nobody else could decide the request
 * (`canSelfApproveLeave`), an organization-wide approver may approve their
 * own leave with a reason. Routes check that before calling this guard.
 * Time corrections and shift swaps have no exception.
 *
 * @example
 * assertNotSelfApproval(ctx, { employeeId: req.employeeId, userId: emp.userId });
 */
export function assertNotSelfApproval(
  ctx: PolicyUserContext,
  subject: ApprovalSubject,
): void {
  if (isOwnRequest(ctx, subject)) {
    throw new SelfApprovalForbiddenError();
  }
}

/**
 * LEA-004 / LEA-008: whether the caller may approve or reject a leave request
 * of `target`. True when their role allows `leave.request.approve` on that
 * employee, or when an active delegation from the employee's manager names
 * them. Never for the caller's own request.
 *
 * @example
 * canDecideLeave(ctx, employee, ["<manager employee id>"]);
 */
export function canDecideLeave(
  ctx: PolicyUserContext,
  target: ScopedEmployee,
  delegatedManagerIds: readonly string[],
): boolean {
  if (isOwnRequest(ctx, { employeeId: target.id, userId: target.userId })) {
    return false;
  }
  if (canOnEmployee(ctx, "leave.request.approve", target)) return true;
  return (
    target.organizationId === ctx.organizationId &&
    target.managerId !== null &&
    delegatedManagerIds.includes(target.managerId)
  );
}

/**
 * TIM-003: whether the caller may approve or reject a time correction of
 * `target`. Delegations do not apply to time records. Never for the caller's
 * own correction.
 *
 * @example
 * canDecideCorrection(ctx, employee);
 */
export function canDecideCorrection(
  ctx: PolicyUserContext,
  target: ScopedEmployee,
): boolean {
  return (
    !isOwnRequest(ctx, { employeeId: target.id, userId: target.userId }) &&
    canOnEmployee(ctx, "time.record.correct", target)
  );
}

/** Scope a role holds for `leave.request.approve`, or null without it. */
function approveScope(role: string): Scope | null {
  const permissions = ROLE_PERMISSIONS[role] ?? [];
  return (
    permissions.find((p) => p.permission === "leave.request.approve")?.scope ??
    null
  );
}

/**
 * LEA-004 / LEA-008: whether anyone other than the caller could decide a
 * leave request of the caller's own employee: another live member whose role
 * allows `leave.request.approve` organization-wide, the requester's manager
 * (reports scope), or an active delegate of that manager. Department and
 * location scopes are not used by built-in roles; they count as "someone
 * else could decide" so the exception fails closed.
 *
 * @example
 * hasOtherLeaveDecider("<caller user id>", candidates);
 */
export function hasOtherLeaveDecider(
  callerUserId: string,
  candidates: readonly LeaveDeciderCandidate[],
): boolean {
  return candidates.some((m) => {
    if (m.userId === callerUserId) return false;
    if (m.isDelegate) return true;
    const scope = approveScope(m.role);
    if (scope === null || scope === "self") return false;
    return scope !== "reports" || m.isManager;
  });
}

/**
 * LEA-004 exception for an organization's sole approver: the caller may
 * approve (never reject) their own leave request when their role allows
 * `leave.request.approve` organization-wide and nobody else could decide it
 * (`hasOtherLeaveDecider`). The route then requires a reason and audits
 * `leave.request.self_approve`.
 *
 * @example
 * await canSelfApproveLeave(tx, ctx, employee, today);
 */
export async function canSelfApproveLeave(
  tx: TenantTx,
  ctx: PolicyUserContext,
  target: ScopedEmployee,
  today: string,
): Promise<boolean> {
  if (!isOwnRequest(ctx, { employeeId: target.id, userId: target.userId })) {
    return false;
  }
  if (target.organizationId !== ctx.organizationId) return false;
  if (approveScope(ctx.role) !== "organization") return false;
  const candidates =
    await new LeaveRepository().listOtherLeaveDeciderCandidates(tx, {
      excludeUserId: ctx.userId,
      managerEmployeeId: target.managerId,
      onDate: today,
    });
  return !hasOtherLeaveDecider(ctx.userId, candidates);
}
