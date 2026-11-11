import { Hono } from "hono";
import type { Sql } from "postgres";
import {
  type AuthUser,
  createProblemDetails,
  CreateScheduleAssignmentSchema,
} from "@librehr/contracts";
import {
  withTenant,
  ScheduleRepository,
  EmployeeRepository,
  AuditRepository,
} from "@librehr/db";
import { businessToday } from "../lib/business-date.js";
import { requireAuth } from "../middleware/auth.js";
import { can } from "../policies/can.js";

export function createScheduleRoutes(sql: Sql) {
  const router = new Hono();
  const scheduleRepo = new ScheduleRepository();
  const employeeRepo = new EmployeeRepository();
  const auditRepo = new AuditRepository();

  // 1. GET /schedules - List organization schedules
  router.get("/schedules", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;

    const schedules = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        return scheduleRepo.list(tx);
      },
    );

    return c.json(schedules);
  });

  // 2. GET /schedules/my-schedule - Active schedule for current employee
  router.get("/schedules/my-schedule", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;

    const data = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        const emp = await employeeRepo.findByUserId(tx, user.id);
        if (!emp) return null;
        return scheduleRepo.getForEmployee(
          tx,
          emp.id,
          await businessToday(c, tx, emp.locationId),
        );
      },
    );

    if (!data) {
      const problem = createProblemDetails({
        status: 404,
        title: "Not Found",
        detail: "No schedule configured for employee",
        code: "SCHEDULE_NOT_FOUND",
      });
      return c.json(problem, 404, {
        "Content-Type": "application/problem+json",
      });
    }

    return c.json(data);
  });

  router.post("/schedules/assignments", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    if (
      !can(
        {
          userId: user.id,
          organizationId: user.organizationId,
          role: user.role,
        },
        "org.write",
      )
    )
      return c.json(
        createProblemDetails({
          status: 403,
          title: "Forbidden",
          detail: "Permission denied",
          code: "FORBIDDEN",
        }),
        403,
        { "Content-Type": "application/problem+json" },
      );
    const parsed = CreateScheduleAssignmentSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!parsed.success)
      return c.json(
        createProblemDetails({
          status: 400,
          title: "Validation failed",
          detail: "Invalid schedule configuration",
          code: "VALIDATION_FAILED",
        }),
        400,
        { "Content-Type": "application/problem+json" },
      );
    const result = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        const created = await scheduleRepo.createAssignment(tx, parsed.data);
        if (typeof created !== "string")
          await auditRepo.log(tx, {
            actorId: user.id,
            action: "schedule.assign",
            resourceType: "schedule",
            resourceId: created.id,
            metadata: {
              employeeId: parsed.data.employeeId,
              effectiveFrom: parsed.data.effectiveFrom,
            },
          });
        return created;
      },
    );
    if (result === "NOT_FOUND")
      return c.json(
        createProblemDetails({
          status: 404,
          title: "Not found",
          detail: "Employee not found",
          code: "NOT_FOUND",
        }),
        404,
        { "Content-Type": "application/problem+json" },
      );
    if (result === "OVERLAP")
      return c.json(
        createProblemDetails({
          status: 409,
          title: "Conflict",
          detail: "Schedule assignment overlaps an existing assignment",
          code: "SCHEDULE_OVERLAP",
        }),
        409,
        { "Content-Type": "application/problem+json" },
      );
    return c.json(result, 201);
  });

  return router;
}
