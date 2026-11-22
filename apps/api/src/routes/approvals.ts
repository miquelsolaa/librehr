import { Hono } from "hono";
import type { Sql } from "postgres";
import { type AuthUser, PENDING_APPROVALS_LIMIT } from "@librehr/contracts";
import {
  EmployeeRepository,
  LeaveRepository,
  TimeCorrectionRepository,
  withTenant,
} from "@librehr/db";
import { requireAuth } from "../middleware/auth.js";
import { businessToday } from "../lib/business-date.js";
import {
  toLeaveRequestResponse,
  toTimeCorrectionResponse,
} from "../lib/approval-items.js";
import {
  canDecideCorrection,
  canDecideLeave,
  canSelfApproveLeave,
} from "../policies/approvals.js";
import { resolvePolicyContext } from "../policies/context.js";

/** Oldest submission first; the id breaks ties so the order is stable. */
function bySubmission(
  a: { createdAt: Date; id: string },
  b: { createdAt: Date; id: string },
): number {
  return (
    a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id)
  );
}

/**
 * LEA-004 / LEA-008 / TIM-003: the approvals inbox. Every pending row of the
 * organization is checked with the predicates the decide endpoints use
 * (`canDecideLeave`, `canDecideCorrection`), so the inbox never offers a
 * decision the API would refuse.
 */
export function createApprovalRoutes(sql: Sql) {
  const router = new Hono();
  const employeeRepo = new EmployeeRepository();
  const leaveRepo = new LeaveRepository();
  const correctionRepo = new TimeCorrectionRepository();

  router.get("/approvals/pending", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;

    const result = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        const ctx = await resolvePolicyContext(c, tx);
        const today = await businessToday(c, tx);
        const delegatedManagerIds = ctx.employeeId
          ? (
              await leaveRepo.getActiveDelegationsForDelegate(
                tx,
                ctx.employeeId,
                today,
              )
            ).map((d) => d.managerEmployeeId)
          : [];

        const leave = await leaveRepo.getLeaveRequests(tx, {
          status: "pending",
        });
        const corrections = await correctionRepo.list(tx, {
          status: "pending",
        });
        // One query for the scope fields of everyone involved (no N+1).
        const scopes = new Map(
          (
            await employeeRepo.findScopeByIds(tx, [
              ...new Set([
                ...leave.map((r) => r.employeeId),
                ...corrections.map((r) => r.employeeId),
              ]),
            ])
          ).map((e) => [e.id, e]),
        );

        // LEA-004 sole-approver exception: the caller's own pending leave is
        // offered (flagged) only when nobody else could decide it. Every row
        // of the caller shares the same target, so it is evaluated once.
        const ownEmployee = ctx.employeeId
          ? scopes.get(ctx.employeeId)
          : undefined;
        const selfApprovable =
          ownEmployee !== undefined &&
          leave.some((r) => r.employeeId === ownEmployee.id) &&
          (await canSelfApproveLeave(tx, ctx, ownEmployee, today));

        const decidableLeave = leave
          .filter((r) => {
            const target = scopes.get(r.employeeId);
            if (!target) return false;
            if (selfApprovable && target.id === ownEmployee?.id) return true;
            return canDecideLeave(ctx, target, delegatedManagerIds);
          })
          .sort(bySubmission);
        const decidableCorrections = corrections
          .filter((r) => {
            const target = scopes.get(r.employeeId);
            return target && canDecideCorrection(ctx, target);
          })
          .sort(bySubmission);

        return {
          leaveRequests: decidableLeave
            .slice(0, PENDING_APPROVALS_LIMIT)
            .map((r) => ({
              ...toLeaveRequestResponse(r),
              selfApproval: selfApprovable && r.employeeId === ownEmployee?.id,
            })),
          timeCorrections: decidableCorrections
            .slice(0, PENDING_APPROVALS_LIMIT)
            .map(toTimeCorrectionResponse),
          truncated:
            decidableLeave.length > PENDING_APPROVALS_LIMIT ||
            decidableCorrections.length > PENDING_APPROVALS_LIMIT,
        };
      },
    );

    return c.json(result);
  });

  return router;
}
