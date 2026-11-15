import { Hono } from "hono";
import type { Sql } from "postgres";
import { type AuthUser, PENDING_APPROVALS_LIMIT } from "@librehr/contracts";
import {
  EmployeeRepository,
  LeaveRepository,
  TimeCorrectionRepository,
  withTenant,
  type TenantTx,
} from "@librehr/db";
import { requireAuth } from "../middleware/auth.js";
import { businessToday } from "../lib/business-date.js";
import {
  toLeaveRequestResponse,
  toTimeCorrectionResponse,
} from "../lib/approval-items.js";
import { canDecideCorrection, canDecideLeave } from "../policies/approvals.js";
import {
  resolvePolicyContext,
  type ScopedEmployee,
} from "../policies/context.js";

/**
 * LEA-004 / LEA-008 / TIM-003: the approvals inbox. Every pending row of the
 * organization is checked with the same predicates the decide endpoints use,
 * so the inbox never offers a decision the API would refuse.
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
        const delegatedManagerIds = ctx.employeeId
          ? (
              await leaveRepo.getActiveDelegationsForDelegate(
                tx,
                ctx.employeeId,
                await businessToday(c, tx),
              )
            ).map((d) => d.managerEmployeeId)
          : [];

        const employees = employeeLoader(tx, employeeRepo);
        const leave = (
          await leaveRepo.getLeaveRequests(tx, { status: "pending" })
        ).reverse(); // oldest first
        const corrections = await correctionRepo.list(tx, {
          status: "pending",
        });

        const leaveRequests = [];
        for (const r of leave) {
          if (leaveRequests.length === PENDING_APPROVALS_LIMIT) break;
          const target = await employees(r.employeeId);
          if (target && canDecideLeave(ctx, target, delegatedManagerIds)) {
            leaveRequests.push(toLeaveRequestResponse(r));
          }
        }
        const timeCorrections = [];
        for (const r of [...corrections].sort(
          (x, y) => x.createdAt.getTime() - y.createdAt.getTime(),
        )) {
          if (timeCorrections.length === PENDING_APPROVALS_LIMIT) break;
          const target = await employees(r.employeeId);
          if (target && canDecideCorrection(ctx, target)) {
            timeCorrections.push(toTimeCorrectionResponse(r));
          }
        }
        return { leaveRequests, timeCorrections };
      },
    );

    return c.json(result);
  });

  return router;
}

/** Loads each employee once per request (many items share an employee). */
function employeeLoader(tx: TenantTx, repo: EmployeeRepository) {
  const cache = new Map<string, Promise<ScopedEmployee | null>>();
  return (id: string) => {
    let hit = cache.get(id);
    if (!hit) {
      hit = repo.findById(tx, id);
      cache.set(id, hit);
    }
    return hit;
  };
}
