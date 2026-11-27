import { Hono, type Context } from "hono";
import type { Sql } from "postgres";
import { z } from "zod";
import {
  type AuthUser,
  type EmployeeMembership,
  type EmployeeMembershipWriteResponse,
  CreateEmployeeMembershipRequestSchema,
  EndEmployeeMembershipRequestSchema,
  UpdateEmployeeMembershipRequestSchema,
} from "@librehr/contracts";
import {
  findOverlappingMembership,
  peakAllocationDuring,
  type EmployeeMembership as CoreMembership,
} from "@librehr/core";
import {
  withTenant,
  AuditRepository,
  DepartmentRepository,
  EmployeeMembershipRepository,
  EmployeeRepository,
  OrgGroupRepository,
  type EmployeeMembershipRow,
  type TenantTx,
} from "@librehr/db";
import { requireAuth } from "../middleware/auth.js";
import {
  requireEmployeeInScope,
  resolvePolicyContext,
} from "../policies/context.js";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../errors/index.js";
import { IdParamSchema, parseJsonBody, parseParams } from "../lib/validate.js";
import { mapPgErrors, PG_EXCLUSION_VIOLATION } from "../lib/pg-errors.js";

const memberships = new EmployeeMembershipRepository();
const employees = new EmployeeRepository();
const departments = new DepartmentRepository();
const groups = new OrgGroupRepository();
const audit = new AuditRepository();

const MembershipParamsSchema = z.object({
  id: z.guid(),
  membershipId: z.guid(),
});

const overlap = () =>
  new ConflictError({
    code: "MEMBERSHIP_OVERLAP",
    detail: "The employee already belongs to this target in that period",
  });
const onOverlap = { [PG_EXCLUSION_VIOLATION]: overlap };

const invalidDates = () =>
  new ValidationError({
    status: 422,
    code: "INVALID_DATES",
    detail: "End date must not precede start date",
  });

const alreadyEnded = () =>
  new ConflictError({
    code: "MEMBERSHIP_ALREADY_ENDED",
    detail: "This membership has already been ended",
  });

const membershipNotFound = () =>
  new NotFoundError({
    code: "MEMBERSHIP_NOT_FOUND",
    detail: "Membership not found",
  });

export function toMembership(row: EmployeeMembershipRow): EmployeeMembership {
  return {
    id: row.id,
    employeeId: row.employeeId,
    departmentId: row.departmentId,
    groupId: row.groupId,
    targetType: row.targetType,
    targetName: row.targetName,
    role: row.role,
    allocationPercent: row.allocationPercent,
    startDate: row.startDate,
    endDate: row.endDate,
    endReason: row.endReason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The write result plus the over-allocation warning (ADR 0008 D3). */
function writeResponse(
  row: EmployeeMembershipRow,
  others: readonly CoreMembership[],
): EmployeeMembershipWriteResponse {
  const peak = peakAllocationDuring([...others, row], row);
  return {
    membership: toMembership(row),
    overAllocation: peak.overAllocated
      ? { date: peak.date, totalPercent: peak.totalPercent }
      : null,
  };
}

/**
 * ORG-007 (ADR 0008): secondary memberships of an employee. Reading needs
 * employee.read on the employee; writing needs employee.write. Rows are never
 * deleted: ending one sets its last day. Changes are audited with ids only.
 */
export function createMembershipRoutes(sql: Sql) {
  const router = new Hono();

  /** Unknown or other-tenant employees are 404; out of scope is 403. */
  const inEmployeeScope = <T>(
    c: Context,
    employeeId: string,
    permission: "employee.read" | "employee.write",
    work: (
      tx: TenantTx,
      user: AuthUser,
      employee: { departmentId: string | null },
    ) => Promise<T>,
  ) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    return mapPgErrors(
      () =>
        withTenant(
          sql,
          { organizationId: user.organizationId, userId: user.id },
          async (tx) => {
            const employee = await requireEmployeeInScope(
              await resolvePolicyContext(c, tx),
              permission,
              async () =>
                (await employees.findScopeByIds(tx, [employeeId]))[0] ?? null,
            );
            return work(tx, user, employee);
          },
        ),
      onOverlap,
    );
  };

  router.get("/employees/:id/memberships", requireAuth, async (c) => {
    const { id } = parseParams(c, IdParamSchema, {
      detail: "Employee not found",
    });
    const rows = await inEmployeeScope(c, id, "employee.read", (tx) =>
      memberships.listForEmployee(tx, id),
    );
    return c.json(rows.map(toMembership));
  });

  router.post("/employees/:id/memberships", requireAuth, async (c) => {
    const { id } = parseParams(c, IdParamSchema, {
      detail: "Employee not found",
    });
    const body = await parseJsonBody(c, CreateEmployeeMembershipRequestSchema);
    const result = await inEmployeeScope(
      c,
      id,
      "employee.write",
      async (tx, user, employee) => {
        if (body.departmentId) {
          if (!(await departments.findById(tx, body.departmentId)))
            throw new NotFoundError({
              code: "DEPARTMENT_NOT_FOUND",
              detail: "Department not found",
            });
          if (body.departmentId === employee.departmentId)
            throw new ValidationError({
              status: 422,
              code: "SECONDARY_IS_PRIMARY",
              detail: "This department is already the employee's primary one",
            });
        } else {
          const group = await groups.findById(tx, body.groupId!);
          if (!group)
            throw new NotFoundError({
              code: "GROUP_NOT_FOUND",
              detail: "Group not found",
            });
          if (group.archivedAt)
            throw new ConflictError({
              code: "GROUP_ARCHIVED",
              detail: "An archived group cannot get new members",
            });
        }
        const existing = await memberships.listForEmployee(tx, id);
        const candidate = {
          departmentId: body.departmentId ?? null,
          groupId: body.groupId ?? null,
          startDate: body.startDate,
          endDate: body.endDate ?? null,
        };
        if (findOverlappingMembership(existing, candidate)) throw overlap();
        const row = await memberships.create(tx, {
          ...(body.departmentId
            ? { departmentId: body.departmentId }
            : { groupId: body.groupId! }),
          employeeId: id,
          role: body.role,
          allocationPercent: body.allocationPercent,
          startDate: body.startDate,
          endDate: body.endDate,
          createdBy: user.id,
        });
        await audit.log(tx, {
          actorId: user.id,
          action: "employee.membership.add",
          resourceType: "employee",
          resourceId: id,
          metadata: {
            membershipId: row.id,
            departmentId: row.departmentId,
            groupId: row.groupId,
          },
        });
        return writeResponse(row, existing);
      },
    );
    return c.json(result, 201);
  });

  router.patch(
    "/employees/:id/memberships/:membershipId",
    requireAuth,
    async (c) => {
      const { id, membershipId } = parseParams(c, MembershipParamsSchema, {
        detail: "Membership not found",
      });
      const body = await parseJsonBody(
        c,
        UpdateEmployeeMembershipRequestSchema,
      );
      const result = await inEmployeeScope(
        c,
        id,
        "employee.write",
        async (tx, user) => {
          const existing = await memberships.listForEmployee(tx, id);
          const current = existing.find((m) => m.id === membershipId);
          if (!current) throw membershipNotFound();
          // A row ended through /end is history: its dates, ended_by and
          // end_reason stay consistent. Role and allocation may still change.
          if (
            current.endedBy &&
            (body.startDate !== undefined || body.endDate !== undefined)
          )
            throw alreadyEnded();
          const merged = {
            ...current,
            startDate: body.startDate ?? current.startDate,
            endDate:
              body.endDate !== undefined ? body.endDate : current.endDate,
          };
          if (merged.endDate !== null && merged.endDate < merged.startDate)
            throw invalidDates();
          const others = existing.filter((m) => m.id !== membershipId);
          if (findOverlappingMembership(others, merged)) throw overlap();
          const row = await memberships.update(tx, id, membershipId, body);
          await audit.log(tx, {
            actorId: user.id,
            action: "employee.membership.update",
            resourceType: "employee",
            resourceId: id,
            metadata: {
              membershipId,
              fields: Object.keys(body).filter(
                (k) => body[k as keyof typeof body] !== undefined,
              ),
            },
          });
          return writeResponse(row!, others);
        },
      );
      return c.json(result);
    },
  );

  router.post(
    "/employees/:id/memberships/:membershipId/end",
    requireAuth,
    async (c) => {
      const { id, membershipId } = parseParams(c, MembershipParamsSchema, {
        detail: "Membership not found",
      });
      const body = await parseJsonBody(c, EndEmployeeMembershipRequestSchema);
      const ended = await inEmployeeScope(
        c,
        id,
        "employee.write",
        async (tx, user) => {
          const current = await memberships.findById(tx, id, membershipId);
          if (!current) throw membershipNotFound();
          if (current.endedBy) throw alreadyEnded();
          if (body.endDate < current.startDate) throw invalidDates();
          const row = await memberships.end(tx, id, membershipId, {
            endDate: body.endDate,
            endedBy: user.id,
            endReason: body.reason,
          });
          await audit.log(tx, {
            actorId: user.id,
            action: "employee.membership.end",
            resourceType: "employee",
            resourceId: id,
            metadata: { membershipId },
          });
          return row!;
        },
      );
      return c.json(toMembership(ended));
    },
  );

  return router;
}
