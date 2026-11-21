import {
  EmployeeRepository,
  LeaveRepository,
  type ActiveMemberRole,
  type TenantTx,
} from "@librehr/db";
import { SelfApprovalForbiddenError } from "../errors/index.js";
import { permissionScope, type PolicyUserContext } from "./can.js";
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

/**
 * LEA-004 / LEA-008: whether anyone other than the caller could decide a
 * leave request of `target` (the caller's own employee): another live member
 * whose role allows `leave.request.approve` over that employee, or an active
 * delegate of the employee's manager who can sign in. Department and
 * location scopes are not used by built-in roles; they count as "someone
 * else could decide" so the exception fails closed.
 *
 * @example
 * hasOtherLeaveDecider(ctx, employee, members, ["<delegate employee id>"]);
 */
export function hasOtherLeaveDecider(
  ctx: PolicyUserContext,
  target: ScopedEmployee,
  others: readonly ActiveMemberRole[],
  activeDelegateEmployeeIds: readonly string[],
): boolean {
  const candidates = others.filter(
    (m) =>
      m.userId !== ctx.userId &&
      (m.employeeId === null || m.employeeId !== ctx.employeeId),
  );
  for (const member of candidates) {
    const scope = permissionScope(
      { ...ctx, userId: member.userId, role: member.role },
      "leave.request.approve",
    );
    if (scope === null || scope === "self") continue;
    if (scope !== "reports") return true;
    if (member.employeeId !== null && member.employeeId === target.managerId) {
      return true;
    }
  }
  const liveEmployees = new Set(candidates.map((m) => m.employeeId));
  return activeDelegateEmployeeIds.some(
    (id) => id !== ctx.employeeId && liveEmployees.has(id),
  );
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
  if (permissionScope(ctx, "leave.request.approve") !== "organization") {
    return false;
  }
  const others = await new EmployeeRepository().listOtherActiveMemberRoles(
    tx,
    ctx.userId,
  );
  const delegates = target.managerId
    ? (
        await new LeaveRepository().getActiveDelegatesForManager(
          tx,
          target.managerId,
          today,
        )
      ).map((d) => d.delegateEmployeeId)
    : [];
  return !hasOtherLeaveDecider(ctx, target, others, delegates);
}
