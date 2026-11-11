import { Hono } from "hono";
import type { Sql } from "postgres";
import { z } from "zod";
import {
  type AuthUser,
  CreateEmploymentPeriodSchema,
  createProblemDetails,
} from "@librehr/contracts";
import {
  AuditRepository,
  EmploymentHistoryRepository,
  withTenant,
} from "@librehr/db";
import { requireAuth } from "../middleware/auth.js";
import { can } from "../policies/can.js";

export function createEmploymentHistoryRoutes(sql: Sql) {
  const router = new Hono();
  const repository = new EmploymentHistoryRepository();
  const audit = new AuditRepository();
  const path = "/employees/:id/employment-history";

  const execute = (write: boolean) => async (c: import("hono").Context) => {
    const user = c.get("user") as AuthUser;
    const id = c.req.param("id") ?? "";
    if (!z.guid().safeParse(id).success) {
      return c.json(
        createProblemDetails({
          status: 404,
          title: "Not Found",
          detail: "Employee not found",
          code: "NOT_FOUND",
        }),
        404,
      );
    }
    if (
      write &&
      !can(
        {
          userId: user.id,
          organizationId: user.organizationId,
          role: user.role,
        },
        "employee.write",
      )
    ) {
      return c.json(
        createProblemDetails({
          status: 403,
          title: "Forbidden",
          detail: "Access denied",
          code: "FORBIDDEN",
        }),
        403,
      );
    }
    let input: z.infer<typeof CreateEmploymentPeriodSchema> | undefined;
    if (write) {
      const body: unknown = await c.req.json().catch(() => null);
      const parsed = CreateEmploymentPeriodSchema.safeParse(body);
      if (!parsed.success)
        return c.json(
          createProblemDetails({
            status: 400,
            title: "Validation Failed",
            detail: "Invalid employment period",
            code: "VALIDATION_FAILED",
          }),
          400,
        );
      input = parsed.data;
    }
    const result = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        // The employee lock serializes concurrent period insertions for the same employee.
        const rows = await tx<
          { userId: string | null; managerId: string | null }[]
        >`
        SELECT user_id AS "userId", manager_id AS "managerId" FROM employees
        WHERE id = ${id} AND organization_id = ${user.organizationId} FOR UPDATE`;
        const target = rows[0];
        if (!target) return { kind: "missing" as const };
        const actors = await tx<
          { id: string }[]
        >`SELECT id FROM employees WHERE user_id = ${user.id} AND organization_id = ${user.organizationId} LIMIT 1`;
        const actorId = actors[0]?.id;
        const allowed = can(
          {
            userId: user.id,
            employeeId: actorId,
            organizationId: user.organizationId,
            role: user.role,
            reports: actorId && target.managerId === actorId ? [id] : [],
          },
          write ? "employee.write" : "employee.read",
          {
            organizationId: user.organizationId,
            employeeId: id,
            ...(target.userId ? { userId: target.userId } : {}),
          },
        );
        if (!allowed) return { kind: "forbidden" as const };
        if (!write || !input)
          return {
            kind: "list" as const,
            periods: await repository.list(tx, id),
          };
        const period = await repository.create(tx, id, input);
        if (!period) return { kind: "conflict" as const };
        await audit.log(tx, {
          actorId: user.id,
          action: "employee.employment_period_created",
          resourceType: "employee",
          resourceId: id,
        });
        return { kind: "created" as const, period };
      },
    );
    if (result.kind === "missing")
      return c.json(
        createProblemDetails({
          status: 404,
          title: "Not Found",
          detail: "Employee not found",
          code: "NOT_FOUND",
        }),
        404,
      );
    if (result.kind === "forbidden")
      return c.json(
        createProblemDetails({
          status: 403,
          title: "Forbidden",
          detail: "Access denied",
          code: "FORBIDDEN",
        }),
        403,
      );
    if (result.kind === "conflict")
      return c.json(
        createProblemDetails({
          status: 409,
          title: "Conflict",
          detail: "Employment periods overlap",
          code: "EMPLOYMENT_OVERLAP",
        }),
        409,
      );
    if (result.kind === "created") return c.json(result.period, 201);
    return c.json(result.periods);
  };
  router.get(path, requireAuth, execute(false));
  router.post(path, requireAuth, execute(true));
  return router;
}
