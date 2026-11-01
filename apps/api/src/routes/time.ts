import { Hono } from "hono";
import type { Sql } from "postgres";
import {
  type AuthUser,
  createProblemDetails,
  ClockRequestSchema,
  TimesheetQuerySchema,
} from "@openhr/contracts";
import {
  foldSessions,
  calculateDailyTimesheet,
  calculatePeriodTimesheet,
  buildInspectionExport,
  computeEventHash,
} from "@openhr/core";
import {
  withTenant,
  TimeRepository,
  EmployeeRepository,
  ScheduleRepository,
  OrganizationRepository,
} from "@openhr/db";
import { requireAuth } from "../middleware/auth.js";
import { can } from "../policies/can.js";

export function createTimeRoutes(sql: Sql) {
  const router = new Hono();
  const timeRepo = new TimeRepository();
  const employeeRepo = new EmployeeRepository();
  const scheduleRepo = new ScheduleRepository();
  const orgRepo = new OrganizationRepository();

  // 1. GET /time/current-status - Current employee's clock state
  router.get("/time/current-status", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;

    const result = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        const emp = await employeeRepo.findByUserId(tx, user.id);
        if (!emp) return null;

        const latest = await timeRepo.getLatestEvent(tx, emp.id);
        if (!latest) {
          return { status: "clocked_out", lastEvent: null };
        }

        const lastEvent = {
          id: latest.id,
          employeeId: latest.employeeId,
          eventType: latest.eventType,
          occurredAt: latest.occurredAt.toISOString(),
          recordedAt: latest.recordedAt.toISOString(),
          source: latest.source,
          actorId: latest.actorId,
          refEventId: latest.refEventId,
          reason: latest.reason,
          prevHash: latest.prevHash,
          hash: latest.hash,
        };

        if (
          latest.eventType === "clock_in" ||
          latest.eventType === "break_end"
        ) {
          return { status: "clocked_in", lastEvent };
        }
        if (latest.eventType === "break_start") {
          return { status: "on_break", lastEvent };
        }
        return { status: "clocked_out", lastEvent };
      },
    );

    if (!result) {
      const problem = createProblemDetails({
        status: 404,
        title: "Not Found",
        detail: "Employee profile not found",
        code: "EMPLOYEE_NOT_FOUND",
      });
      return c.json(problem, 404, {
        "Content-Type": "application/problem+json",
      });
    }

    return c.json(result);
  });

  // 2. POST /time/clock - Append clock event with hash chaining
  router.post("/time/clock", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    const body = await c.req.json().catch(() => null);
    const parsed = ClockRequestSchema.safeParse(body);

    if (!parsed.success) {
      const problem = createProblemDetails({
        status: 400,
        title: "Bad Request",
        detail: parsed.error.errors.map((e) => e.message).join(", "),
        code: "VALIDATION_ERROR",
        errors: parsed.error.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
        })),
      });
      return c.json(problem, 400, {
        "Content-Type": "application/problem+json",
      });
    }

    const clockData = parsed.data;

    const result = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        const emp = await employeeRepo.findByUserId(tx, user.id);
        if (!emp) return { error: "NO_EMPLOYEE" as const };

        const latest = await timeRepo.getLatestEvent(tx, emp.id);
        const prevHash = latest?.hash ?? null;

        const occurredAt = clockData.occurredAt
          ? new Date(clockData.occurredAt)
          : new Date();
        const recordedAt = new Date();

        const hash = computeEventHash(prevHash, {
          organizationId: user.organizationId,
          employeeId: emp.id,
          eventType: clockData.eventType,
          occurredAt: occurredAt.toISOString(),
          recordedAt: recordedAt.toISOString(),
          source: clockData.source,
          actorId: user.id,
          reason: clockData.notes,
        });

        const created = await timeRepo.appendEvent(tx, {
          employeeId: emp.id,
          eventType: clockData.eventType,
          occurredAt,
          source: clockData.source,
          actorId: user.id,
          reason: clockData.notes,
          prevHash,
          hash,
        });

        return { event: created };
      },
    );

    if ("error" in result) {
      const problem = createProblemDetails({
        status: 404,
        title: "Not Found",
        detail: "Employee profile required to clock",
        code: "EMPLOYEE_NOT_FOUND",
      });
      return c.json(problem, 404, {
        "Content-Type": "application/problem+json",
      });
    }

    const { event: e } = result;
    return c.json(
      {
        id: e.id,
        employeeId: e.employeeId,
        eventType: e.eventType,
        occurredAt: e.occurredAt.toISOString(),
        recordedAt: e.recordedAt.toISOString(),
        source: e.source,
        actorId: e.actorId,
        refEventId: e.refEventId,
        reason: e.reason,
        prevHash: e.prevHash,
        hash: e.hash,
      },
      201,
    );
  });

  // 3. GET /time/timesheet - Calculated daily/weekly/monthly breakdown
  router.get("/time/timesheet", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    const query = TimesheetQuerySchema.safeParse(c.req.query());

    if (!query.success) {
      const problem = createProblemDetails({
        status: 400,
        title: "Bad Request",
        detail: query.error.errors.map((e) => e.message).join(", "),
        code: "VALIDATION_ERROR",
      });
      return c.json(problem, 400, {
        "Content-Type": "application/problem+json",
      });
    }

    const { startDate, endDate, employeeId: requestedEmpId } = query.data;

    const data = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        let employeeId = requestedEmpId;
        if (!employeeId) {
          const currentEmp = await employeeRepo.findByUserId(tx, user.id);
          if (!currentEmp) return "NO_EMPLOYEE";
          employeeId = currentEmp.id;
        } else {
          // If viewing another employee's timesheet, check permission
          const emp = await employeeRepo.findById(tx, employeeId);
          if (!emp) return "NOT_FOUND";
          if (emp.userId !== user.id) {
            const allowed = can(
              {
                userId: user.id,
                organizationId: user.organizationId,
                role: user.role,
              },
              "time.record.read",
              {
                organizationId: user.organizationId,
                employeeId: emp.id,
                managerId: emp.managerId ?? undefined,
              },
            );
            if (!allowed) return "FORBIDDEN";
          }
        }

        // Fetch events for period
        const events = await timeRepo.getEventsForEmployee(
          tx,
          employeeId,
          `${startDate}T00:00:00Z`,
          `${endDate}T23:59:59Z`,
        );

        // Fetch schedule rules for employee
        const schedData = await scheduleRepo.getForEmployee(tx, employeeId);
        const rulesMap = new Map<
          number,
          { dayOfWeek: number; expectedHours: number }
        >();
        if (schedData) {
          for (const r of schedData.rules) {
            rulesMap.set(r.dayOfWeek, {
              dayOfWeek: r.dayOfWeek,
              expectedHours: r.expectedHours,
            });
          }
        }

        // Group events by YYYY-MM-DD
        const eventsByDay = new Map<string, typeof events>();
        for (const ev of events) {
          const dayKey = ev.occurredAt.toISOString().slice(0, 10);
          const list = eventsByDay.get(dayKey) ?? [];
          list.push(ev);
          eventsByDay.set(dayKey, list);
        }

        // Generate daily summaries between startDate and endDate
        const dailySummaries = [];
        const curr = new Date(startDate);
        const end = new Date(endDate);

        while (curr <= end) {
          const dayStr = curr.toISOString().slice(0, 10);
          const dayEvents = eventsByDay.get(dayStr) ?? [];

          const sessions = foldSessions(
            dayEvents.map((e) => ({
              id: e.id,
              organizationId: e.organizationId,
              employeeId: e.employeeId,
              eventType: e.eventType as
                | "clock_in"
                | "clock_out"
                | "break_start"
                | "break_end"
                | "correction",
              occurredAt: e.occurredAt.toISOString(),
              recordedAt: e.recordedAt.toISOString(),
              source:
                (e.source as "web" | "mobile" | "manual" | "import") ?? "web",
              actorId: e.actorId,
              hash: e.hash,
              prevHash: e.prevHash,
            })),
          );

          const dayOfWeek = curr.getUTCDay() || 7;
          const rule = rulesMap.get(dayOfWeek);

          const daily = calculateDailyTimesheet(dayStr, sessions, rule);
          dailySummaries.push(daily);

          curr.setUTCDate(curr.getUTCDate() + 1);
        }

        return calculatePeriodTimesheet(dailySummaries);
      },
    );

    if (data === "NO_EMPLOYEE" || data === "NOT_FOUND") {
      const problem = createProblemDetails({
        status: 404,
        title: "Not Found",
        detail: "Employee not found",
        code: "EMPLOYEE_NOT_FOUND",
      });
      return c.json(problem, 404, {
        "Content-Type": "application/problem+json",
      });
    }

    if (data === "FORBIDDEN") {
      const problem = createProblemDetails({
        status: 403,
        title: "Forbidden",
        detail: "You do not have permission to view this timesheet",
        code: "FORBIDDEN",
      });
      return c.json(problem, 403, {
        "Content-Type": "application/problem+json",
      });
    }

    return c.json(data);
  });

  // 4. GET /time/export - Official Labour Inspectorate export with cryptographic hash
  router.get("/time/export", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    const query = TimesheetQuerySchema.safeParse(c.req.query());

    if (!query.success) {
      const problem = createProblemDetails({
        status: 400,
        title: "Bad Request",
        detail: query.error.errors.map((e) => e.message).join(", "),
        code: "VALIDATION_ERROR",
      });
      return c.json(problem, 400, {
        "Content-Type": "application/problem+json",
      });
    }

    const { startDate, endDate, employeeId: requestedEmpId } = query.data;

    const doc = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        let employeeId = requestedEmpId;
        if (!employeeId) {
          const currentEmp = await employeeRepo.findByUserId(tx, user.id);
          if (!currentEmp) return null;
          employeeId = currentEmp.id;
        }

        const emp = await employeeRepo.findById(tx, employeeId);
        if (!emp) return null;

        const org = await orgRepo.findById(tx, user.organizationId);
        const orgName = org?.name ?? "OpenHR Organization";

        const events = await timeRepo.getEventsForEmployee(
          tx,
          employeeId,
          `${startDate}T00:00:00Z`,
          `${endDate}T23:59:59Z`,
        );

        // Group by day
        const eventsByDay = new Map<string, typeof events>();
        for (const ev of events) {
          const dayKey = ev.occurredAt.toISOString().slice(0, 10);
          const list = eventsByDay.get(dayKey) ?? [];
          list.push(ev);
          eventsByDay.set(dayKey, list);
        }

        const dailySummaries = [];
        const curr = new Date(startDate);
        const end = new Date(endDate);

        while (curr <= end) {
          const dayStr = curr.toISOString().slice(0, 10);
          const dayEvents = eventsByDay.get(dayStr) ?? [];

          const sessions = foldSessions(
            dayEvents.map((e) => ({
              id: e.id,
              organizationId: e.organizationId,
              employeeId: e.employeeId,
              eventType: e.eventType as
                | "clock_in"
                | "clock_out"
                | "break_start"
                | "break_end"
                | "correction",
              occurredAt: e.occurredAt.toISOString(),
              recordedAt: e.recordedAt.toISOString(),
              source:
                (e.source as "web" | "mobile" | "manual" | "import") ?? "web",
              actorId: e.actorId,
              hash: e.hash,
              prevHash: e.prevHash,
            })),
          );

          dailySummaries.push(calculateDailyTimesheet(dayStr, sessions));
          curr.setUTCDate(curr.getUTCDate() + 1);
        }

        return buildInspectionExport(
          {
            organizationId: user.organizationId,
            organizationName: orgName,
            employeeId: emp.id,
            employeeName: `${emp.firstName} ${emp.lastName}`,
            periodStart: startDate,
            periodEnd: endDate,
            generatedAt: new Date().toISOString(),
            generatorActorId: user.id,
          },
          dailySummaries,
        );
      },
    );

    if (!doc) {
      const problem = createProblemDetails({
        status: 404,
        title: "Not Found",
        detail: "Employee not found",
        code: "EMPLOYEE_NOT_FOUND",
      });
      return c.json(problem, 404, {
        "Content-Type": "application/problem+json",
      });
    }

    return c.json(doc);
  });

  return router;
}
