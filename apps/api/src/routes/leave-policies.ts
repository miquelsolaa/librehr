import { Hono } from "hono";
import type { Sql } from "postgres";
import {
  type AuthUser,
  type LeavePolicy,
  CreateLeavePolicyRequestSchema,
  LeavePolicySchema,
  UpdateLeavePolicyRequestSchema,
} from "@librehr/contracts";
import {
  withTenant,
  AuditRepository,
  LeaveRepository,
  type LeavePolicyRow,
} from "@librehr/db";
import { requireAuth } from "../middleware/auth.js";
import { can } from "../policies/can.js";
import { ForbiddenError, NotFoundError } from "../errors/index.js";
import { IdParamSchema, parseJsonBody, parseParams } from "../lib/validate.js";

const currentUser = (c: { get: unknown }) =>
  (c.get as (key: string) => unknown)("user") as AuthUser;

/** Leave policies are organization configuration, like leave types. */
function requireOrgWrite(user: AuthUser): void {
  if (
    !can(
      {
        userId: user.id,
        organizationId: user.organizationId,
        role: user.role,
      },
      "org.write",
    )
  ) {
    throw new ForbiddenError({
      detail: "You do not have permission to configure leave policies",
    });
  }
}

const toResponse = (row: LeavePolicyRow): LeavePolicy =>
  LeavePolicySchema.parse({
    id: row.id,
    leaveTypeId: row.leaveTypeId,
    name: row.name,
    annualAllowanceDays: row.annualAllowanceDays,
    accrualMethod: row.accrualMethod,
    carryoverMaxDays: row.carryoverMaxDays,
    carryoverExpiryMonths: row.carryoverExpiryMonths,
    allowNegativeBalance: row.allowNegativeBalance,
    fullTimeHoursPerWeek: row.fullTimeHoursPerWeek,
  });

/**
 * Leave policies (LEA-002): list, create, and set the opt-in part-time
 * full-time week (issue #118). Admin only (`org.write`).
 */
export function createLeavePolicyRoutes(sql: Sql) {
  const router = new Hono();
  const leaveRepo = new LeaveRepository();
  const auditRepo = new AuditRepository();

  router.get("/leave/policies", requireAuth, async (c) => {
    const user = currentUser(c);
    requireOrgWrite(user);
    const rows = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      (tx) => leaveRepo.getLeavePolicies(tx),
    );
    return c.json(rows.map(toResponse));
  });

  router.post("/leave/policies", requireAuth, async (c) => {
    const user = currentUser(c);
    requireOrgWrite(user);
    const body = await parseJsonBody(c, CreateLeavePolicyRequestSchema);
    const row = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        if (!(await leaveRepo.findLeaveTypeById(tx, body.leaveTypeId))) {
          throw new NotFoundError({
            code: "LEAVE_TYPE_NOT_FOUND",
            detail: "Leave type not found",
          });
        }
        const created = await leaveRepo.createLeavePolicy(tx, body);
        await auditRepo.log(tx, {
          actorId: user.id,
          action: "leave.policy.create",
          resourceType: "leave_policy",
          resourceId: created.id,
          metadata: {
            leaveTypeId: created.leaveTypeId,
            fullTimeHoursPerWeek: created.fullTimeHoursPerWeek,
          },
        });
        return created;
      },
    );
    return c.json(toResponse(row), 201);
  });

  router.patch("/leave/policies/:id", requireAuth, async (c) => {
    const user = currentUser(c);
    requireOrgWrite(user);
    const { id } = parseParams(c, IdParamSchema, {
      code: "LEAVE_POLICY_NOT_FOUND",
      detail: "Leave policy not found",
    });
    const body = await parseJsonBody(c, UpdateLeavePolicyRequestSchema);
    const row = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        const updated = await leaveRepo.updateLeavePolicyFullTimeHours(
          tx,
          id,
          body.fullTimeHoursPerWeek,
        );
        if (!updated) {
          throw new NotFoundError({
            code: "LEAVE_POLICY_NOT_FOUND",
            detail: "Leave policy not found",
          });
        }
        await auditRepo.log(tx, {
          actorId: user.id,
          action: "leave.policy.update",
          resourceType: "leave_policy",
          resourceId: updated.id,
          metadata: { fullTimeHoursPerWeek: updated.fullTimeHoursPerWeek },
        });
        return updated;
      },
    );
    return c.json(toResponse(row));
  });

  return router;
}
