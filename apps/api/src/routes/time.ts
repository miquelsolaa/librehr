import { Hono } from "hono";
import type { Sql } from "postgres";
import {
  type AuthUser,
  createProblemDetails,
  ClockRequestSchema,
  KioskClockRequestSchema,
  TimesheetQuerySchema,
  CreateTimeBankEntrySchema,
} from "@librehr/contracts";
import {
  foldSessions,
  splitSessionsByLocalDay,
  calculateDailyTimesheet,
  calculatePeriodTimesheet,
  buildInspectionExport,
  computeEventHash,
  verifyKioskPin,
  calculateTimeBankBalance,
} from "@librehr/core";
import {
  withTenant,
  TimeRepository,
  EmployeeRepository,
  ScheduleRepository,
  OrganizationRepository,
  AuditRepository,
  type TimeEventRow,
} from "@librehr/db";
import { requireAuth } from "../middleware/auth.js";
import { permissionScope } from "../policies/can.js";
import {
  canOnEmployee,
  requireEmployeeInScope,
  resolvePolicyContext,
} from "../policies/context.js";

function foldRecordedEvents(events: TimeEventRow[]) {
  return foldSessions(
    events.map((event) => ({
      id: event.id,
      organizationId: event.organizationId,
      employeeId: event.employeeId,
      eventType: event.eventType as
        "clock_in" | "clock_out" | "break_start" | "break_end" | "correction",
      occurredAt: event.occurredAt.toISOString(),
      recordedAt: event.recordedAt.toISOString(),
      source: event.source as "web" | "mobile" | "manual" | "import",
      actorId: event.actorId,
      ...(event.refEventId ? { refEventId: event.refEventId } : {}),
      hash: event.hash,
      prevHash: event.prevHash,
    })),
  );
}

export function createTimeRoutes(sql: Sql) {
  const router = new Hono();
  const timeRepo = new TimeRepository();
  const employeeRepo = new EmployeeRepository();
  const scheduleRepo = new ScheduleRepository();
  const orgRepo = new OrganizationRepository();
  const auditRepo = new AuditRepository();

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

  // TIM-010: POST /time/kiosk/clock - Tablet Kiosk mode clocking with PIN/badge verification
  router.post("/time/kiosk/clock", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    const body = await c.req.json().catch(() => null);
    const parsed = KioskClockRequestSchema.safeParse(body);

    if (!parsed.success) {
      const problem = createProblemDetails({
        status: 400,
        title: "Bad Request",
        detail: parsed.error.errors.map((err) => err.message).join(", "),
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

    const { identifier, pin, eventType } = parsed.data;

    const result = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        const emp = await employeeRepo.findByIdentifier(tx, identifier);
        if (!emp || !emp.pinHash || !emp.pinSalt) {
          return { error: "INVALID_CREDENTIALS" as const };
        }

        const validPin = verifyKioskPin(pin, emp.pinHash, emp.pinSalt);
        if (!validPin) {
          return { error: "INVALID_CREDENTIALS" as const };
        }

        const latest = await timeRepo.getLatestEvent(tx, emp.id);
        const prevHash = latest ? latest.hash : null;
        const now = new Date();
        const occurredAtStr = now.toISOString();

        const canonical = {
          organizationId: user.organizationId,
          employeeId: emp.id,
          eventType,
          occurredAt: occurredAtStr,
          recordedAt: occurredAtStr,
          source: "kiosk",
          actorId: emp.userId ?? user.id,
        };

        const hash = computeEventHash(prevHash, canonical);

        await timeRepo.appendEvent(tx, {
          employeeId: emp.id,
          eventType,
          occurredAt: now,
          source: "kiosk",
          actorId: emp.userId ?? user.id,
          prevHash,
          hash,
        });

        await auditRepo.log(tx, {
          actorId: user.id,
          action: "time.kiosk_clock",
          resourceType: "time_event",
          resourceId: emp.id,
          metadata: {
            eventType,
            source: "kiosk",
          },
        });

        let newStatus: "clocked_in" | "on_break" | "clocked_out" =
          "clocked_out";
        if (eventType === "clock_in" || eventType === "break_end") {
          newStatus = "clocked_in";
        } else if (eventType === "break_start") {
          newStatus = "on_break";
        }

        return {
          success: true,
          employeeName: `${emp.firstName} ${emp.lastName}`,
          eventType,
          occurredAt: occurredAtStr,
          newStatus,
        };
      },
    );

    if (result.error === "INVALID_CREDENTIALS") {
      const problem = createProblemDetails({
        status: 401,
        title: "Unauthorized",
        detail: "Invalid identifier or PIN",
        code: "INVALID_CREDENTIALS",
      });
      return c.json(problem, 401, {
        "Content-Type": "application/problem+json",
      });
    }

    return c.json(result);
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
          if (emp.userId !== user.id && user.role !== "auditor") {
            const allowed = canOnEmployee(
              await resolvePolicyContext(c, tx),
              "time.record.read",
              emp,
            );
            if (!allowed) return "FORBIDDEN";
          }

          if (user.role === "auditor") {
            await auditRepo.log(tx, {
              actorId: user.id,
              action: "inspector.timesheet_access",
              resourceType: "timesheet",
              resourceId: employeeId,
              metadata: {
                inspectorEmail: user.email,
                periodStart: startDate,
                periodEnd: endDate,
              },
            });
          }
        }

        const org = await orgRepo.findById(tx, user.organizationId);
        if (!org) return "NOT_FOUND" as const;
        // Include the enclosing session when it starts or ends outside the period.
        const events = await timeRepo.getEventsForEmployee(tx, employeeId);

        const sessionsByDay = splitSessionsByLocalDay(
          foldRecordedEvents(events),
          startDate,
          endDate,
          org.timezone,
        );

        // Generate daily summaries between startDate and endDate
        const dailySummaries = [];
        const curr = new Date(startDate);
        const end = new Date(endDate);

        while (curr <= end) {
          const dayStr = curr.toISOString().slice(0, 10);
          const sessions = sessionsByDay.get(dayStr) ?? [];

          const dayOfWeek = curr.getUTCDay() || 7;
          const schedule = await scheduleRepo.getForEmployee(
            tx,
            employeeId,
            dayStr,
          );
          if (!schedule) return "SCHEDULE_NOT_CONFIGURED" as const;
          const rule = schedule.rules.find(
            (item) => item.dayOfWeek === dayOfWeek,
          ) ?? {
            dayOfWeek,
            expectedHours: 0,
          };

          const daily = calculateDailyTimesheet(dayStr, sessions, {
            dayOfWeek: rule.dayOfWeek,
            expectedHours: rule.expectedHours,
          });
          dailySummaries.push(daily);

          curr.setUTCDate(curr.getUTCDate() + 1);
        }

        return calculatePeriodTimesheet(dailySummaries);
      },
    );

    if (data === "SCHEDULE_NOT_CONFIGURED") {
      return c.json(
        createProblemDetails({
          status: 409,
          title: "Schedule not configured",
          detail:
            "Configure a schedule rule for every day in the requested period.",
          code: "SCHEDULE_NOT_CONFIGURED",
        }),
        409,
        { "Content-Type": "application/problem+json" },
      );
    }

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

        if (emp.userId !== user.id && user.role !== "auditor") {
          const allowed = canOnEmployee(
            await resolvePolicyContext(c, tx),
            "time.record.read",
            emp,
          );
          if (!allowed) return "FORBIDDEN";
        }

        if (user.role === "auditor") {
          await auditRepo.log(tx, {
            actorId: user.id,
            action: "inspector.export_access",
            resourceType: "official_inspection_export",
            resourceId: employeeId,
            metadata: {
              inspectorEmail: user.email,
              periodStart: startDate,
              periodEnd: endDate,
            },
          });
        }

        const org = await orgRepo.findById(tx, user.organizationId);
        if (!org) return null;
        const orgName = org.name;

        const events = await timeRepo.getEventsForEmployee(tx, employeeId);

        const sessionsByDay = splitSessionsByLocalDay(
          foldRecordedEvents(events),
          startDate,
          endDate,
          org.timezone,
        );

        const dailySummaries = [];
        const curr = new Date(startDate);
        const end = new Date(endDate);

        while (curr <= end) {
          const dayStr = curr.toISOString().slice(0, 10);
          const sessions = sessionsByDay.get(dayStr) ?? [];

          const dayOfWeek = curr.getUTCDay() || 7;
          const schedule = await scheduleRepo.getForEmployee(
            tx,
            employeeId,
            dayStr,
          );
          if (!schedule) return "SCHEDULE_NOT_CONFIGURED" as const;
          const rule = schedule.rules.find(
            (item) => item.dayOfWeek === dayOfWeek,
          ) ?? {
            dayOfWeek,
            expectedHours: 0,
          };
          dailySummaries.push(
            calculateDailyTimesheet(dayStr, sessions, {
              dayOfWeek: rule.dayOfWeek,
              expectedHours: rule.expectedHours,
            }),
          );
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

    if (doc === "SCHEDULE_NOT_CONFIGURED") {
      return c.json(
        createProblemDetails({
          status: 409,
          title: "Schedule not configured",
          detail:
            "Configure a schedule rule for every day in the requested period.",
          code: "SCHEDULE_NOT_CONFIGURED",
        }),
        409,
        { "Content-Type": "application/problem+json" },
      );
    }

    if (doc === "FORBIDDEN") {
      const problem = createProblemDetails({
        status: 403,
        title: "Forbidden",
        detail: "You do not have permission to export this timesheet",
        code: "FORBIDDEN",
      });
      return c.json(problem, 403, {
        "Content-Type": "application/problem+json",
      });
    }

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

  // TIM-012: GET /time/time-bank - Get employee time bank summary and history
  router.get("/time/time-bank", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    const requestedEmpId = c.req.query("employeeId");

    const result = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        let employeeId = requestedEmpId;
        if (!employeeId) {
          const current = await employeeRepo.findByUserId(tx, user.id);
          if (!current) return "NO_EMPLOYEE";
          employeeId = current.id;
        }

        const emp = await employeeRepo.findById(tx, employeeId);
        if (!emp) return "NOT_FOUND";

        // Check permission: employee can see self, manager can see reports, admin can see all
        if (emp.userId !== user.id && user.role !== "auditor") {
          const allowed = canOnEmployee(
            await resolvePolicyContext(c, tx),
            "time.record.read",
            emp,
          );
          if (!allowed) return "FORBIDDEN";
        }

        const records = await timeRepo.getTimeBankRecords(tx, employeeId);
        const summary = calculateTimeBankBalance(
          records.map((r) => ({
            type: r.type as
              | "overtime_accrual"
              | "compensatory_rest_taken"
              | "manual_adjustment"
              | "expired",
            minutes: r.minutes,
            referenceDate: r.referenceDate,
          })),
        );

        return {
          ...summary,
          records: records.map((r) => ({
            ...r,
            createdAt: r.createdAt.toISOString(),
          })),
        };
      },
    );

    if (result === "NO_EMPLOYEE" || result === "NOT_FOUND") {
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

    if (result === "FORBIDDEN") {
      const problem = createProblemDetails({
        status: 403,
        title: "Forbidden",
        detail: "You do not have permission to view this time bank",
        code: "FORBIDDEN",
      });
      return c.json(problem, 403, {
        "Content-Type": "application/problem+json",
      });
    }

    return c.json(result);
  });

  // TIM-012: POST /time/time-bank/entries - Record overtime accrual or compensatory rest
  router.post("/time/time-bank/entries", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    const body = await c.req.json().catch(() => null);
    const parse = CreateTimeBankEntrySchema.safeParse(body);

    if (!parse.success) {
      const problem = createProblemDetails({
        status: 400,
        title: "Validation Error",
        detail: parse.error.errors.map((e) => e.message).join(", "),
        code: "VALIDATION_ERROR",
      });
      return c.json(problem, 400, {
        "Content-Type": "application/problem+json",
      });
    }

    // Role check up front; the per-employee scope check happens below.
    if (
      !permissionScope(
        {
          userId: user.id,
          organizationId: user.organizationId,
          role: user.role,
        },
        "time.record.correct",
      )
    ) {
      const problem = createProblemDetails({
        status: 403,
        title: "Forbidden",
        detail: "You do not have permission to record time bank entries",
        code: "FORBIDDEN",
      });
      return c.json(problem, 403, {
        "Content-Type": "application/problem+json",
      });
    }

    const created = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        // Managers may only credit their direct reports (never themselves).
        await requireEmployeeInScope(
          await resolvePolicyContext(c, tx),
          "time.record.correct",
          () => employeeRepo.findById(tx, parse.data.employeeId),
          "EMPLOYEE_NOT_FOUND",
        );

        const record = await timeRepo.createTimeBankRecord(tx, {
          employeeId: parse.data.employeeId,
          type: parse.data.type,
          minutes: parse.data.minutes,
          referenceDate: parse.data.referenceDate,
          notes: parse.data.notes,
          actorId: user.id,
        });

        await auditRepo.log(tx, {
          actorId: user.id,
          action: "time.time_bank_entry",
          resourceType: "time_bank_record",
          resourceId: record.id,
          metadata: {
            employeeId: parse.data.employeeId,
            type: parse.data.type,
            minutes: parse.data.minutes,
          },
        });

        return {
          ...record,
          createdAt: record.createdAt.toISOString(),
        };
      },
    );

    return c.json(created, 201);
  });

  return router;
}
