import type { Context } from "hono";
import { planPrimaryDepartmentChange } from "@librehr/core";
import {
  AuditRepository,
  DepartmentRepository,
  EmployeeMembershipRepository,
  type TenantTx,
} from "@librehr/db";
import { ConflictError, NotFoundError } from "../errors/index.js";
import { businessToday } from "./business-date.js";

const departments = new DepartmentRepository();
const memberships = new EmployeeMembershipRepository();
const audit = new AuditRepository();

/**
 * A department id from a request body must exist in the caller's tenant: the
 * employees.department_id foreign key alone would accept another tenant's id.
 */
export async function requireDepartmentInTenant(
  tx: TenantTx,
  departmentId: string,
): Promise<void> {
  if (!(await departments.findById(tx, departmentId)))
    throw new NotFoundError({
      code: "DEPARTMENT_NOT_FOUND",
      detail: "Department not found",
    });
}

/**
 * ORG-007 (ADR 0008 decision 3): when the primary department changes to one
 * the employee holds as a secondary, that secondary ends the day before (the
 * organization's business date), in the caller's transaction, so primary and
 * secondaries stay disjoint. A secondary that starts today or later cannot
 * end before it starts: the change is refused with 409 and the membership
 * must be adjusted first. Audited with ids only.
 */
export async function endSecondariesInNewPrimary(
  c: Context,
  tx: TenantTx,
  input: { employeeId: string; departmentId: string; actorId: string },
): Promise<void> {
  const rows = await memberships.listForEmployee(tx, input.employeeId);
  const today = await businessToday(c, tx);
  const plan = planPrimaryDepartmentChange(rows, input.departmentId, today);
  if (plan.conflicts.length > 0)
    throw new ConflictError({
      code: "PRIMARY_OVERLAPS_SECONDARY",
      detail:
        "The employee has a membership in this department starting today or later; change or end it first",
    });
  for (const { membership, endDate } of plan.toEnd) {
    await memberships.end(tx, input.employeeId, membership.id, {
      endDate,
      endedBy: input.actorId,
      endReason: "primary_changed",
    });
    await audit.log(tx, {
      actorId: input.actorId,
      action: "employee.membership.end",
      resourceType: "employee",
      resourceId: input.employeeId,
      metadata: { membershipId: membership.id },
    });
  }
}
