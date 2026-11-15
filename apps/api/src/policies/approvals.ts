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
 * Known limitation: an organization whose only approver is a single admin
 * with no manager of their own cannot get that admin's requests decided in
 * the product. Their requests need another admin, or a manager set as their
 * manager, to decide them. There is deliberately no override; see
 * docs/functionality.md ("Approvals").
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
