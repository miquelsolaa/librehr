import { Hono } from "hono";
import type { Sql } from "postgres";
import { type AuthUser, createProblemDetails } from "@openhr/contracts";
import { withTenant, ScheduleRepository, EmployeeRepository } from "@openhr/db";
import { requireAuth } from "../middleware/auth.js";

export function createScheduleRoutes(sql: Sql) {
  const router = new Hono();
  const scheduleRepo = new ScheduleRepository();
  const employeeRepo = new EmployeeRepository();

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
        return scheduleRepo.getForEmployee(tx, emp.id);
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

  return router;
}
