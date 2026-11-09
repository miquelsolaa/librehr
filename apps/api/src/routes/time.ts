import { Hono, type Context } from "hono";
import type { Sql } from "postgres";
import {
  type AuthUser,
  createProblemDetails,
  ClockRequestSchema,
  TimesheetQuerySchema,
  CreateTimeBankEntrySchema,
} from "@librehr/contracts";
import {
  foldSessions,
  buildLocalPeriodTimesheet,
  buildInspectionExport,
  calculateTimeBankBalance,
  isWithinClockWindow,
} from "@librehr/core";
import {
  withTenant,
  TimeRepository,
  EmployeeRepository,
  ScheduleRepository,
  OrganizationRepository,
  AuditRepository,
  type TenantTx,
  type TimeEventRow,
  type TimeChainSigner,
} from "@librehr/db";
import { requireAuth } from "../middleware/auth.js";
import { permissionScope } from "../policies/can.js";
import { TimeEventOutOfWindowError } from "../errors/index.js";
import { resolveBusinessTimeZone } from "../lib/business-date.js";
import { parseJsonBody } from "../lib/validate.js";
import type { TimeTrackingConfig } from "../lib/time-tracking-config.js";
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
      source: event.source as "web" | "mobile" | "kiosk" | "manual" | "import",
      actorId: event.actorId,
      ...(event.refEventId ? { refEventId: event.refEventId } : {}),
      hash: event.hash,
      prevHash: event.prevHash,
    })),
  );
}

export function createTimeRoutes(
  sql: Sql,
  options: { sign: TimeChainSigner; config: TimeTrackingConfig },
) {
  const router = new Hono();
  const timeRepo = new TimeRepository();
  const employeeRepo = new EmployeeRepository();
  const scheduleRepo = new ScheduleRepository();
  const orgRepo = new OrganizationRepository();
  const auditRepo = new AuditRepository();

  /**
   * TIM-004/TIM-005: one events query and one schedule query for the whole
   * period; core splits work into local days (local midnight to local
   * midnight, so 23 or 25 hours across DST) and resolves each day's schedule.
   */
  async function buildTimesheet(
    c: Context,
    tx: TenantTx,
    args: {
      employeeId: string;
      locationId: string | null;
      startDate: string;
      endDate: string;
    },
  ) {
    const timeZone = await resolveBusinessTimeZone(c, tx, args.locationId);
    // Include the enclosing session when it starts or ends outside the period.
    const events = await timeRepo.getEventsForEmployee(tx, args.employeeId);
    const schedules = await scheduleRepo.getScheduleSpansForEmployee(
      tx,
      args.employeeId,
      args.startDate,
      args.endDate,
    );
    return buildLocalPeriodTimesheet({
      startDate: args.startDate,
      endDate: args.endDate,
      timeZone,
      sessions: foldRecordedEvents(events),
      schedules,
    });
  }

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

  // 2. POST /time/clock - Append clock event to the employee's hash chain
  router.post("/time/clock", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    const clockData = await parseJsonBody(c, ClockRequestSchema);

    // TIM-002/TIM-003: a direct punch is "now". A client clock may drift a
    // little, but a backdated punch must go through a correction.
    let occurredAt: Date | undefined;
    if (clockData.occurredAt) {
      occurredAt = new Date(clockData.occurredAt);
      if (
        !isWithinClockWindow(
          occurredAt,
          new Date(),
          options.config.clockToleranceMs,
        )
      ) {
        throw new TimeEventOutOfWindowError(options.config.clockToleranceMs);
      }
    }

    const result = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        const emp = await employeeRepo.findByUserId(tx, user.id);
        if (!emp) return { error: "NO_EMPLOYEE" as const };

        const created = await timeRepo.appendEvent(tx, options.sign, {
          organizationId: user.organizationId,
          employeeId: emp.id,
          eventType: clockData.eventType,
          occurredAt,
          // Set by the route, never by the client: only the kiosk route records "kiosk".
          source: "web",
          actorId: user.id,
          reason: clockData.notes,
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
        let locationId: string | null;
        if (!employeeId) {
          const currentEmp = await employeeRepo.findByUserId(tx, user.id);
          if (!currentEmp) return "NO_EMPLOYEE";
          employeeId = currentEmp.id;
          locationId = currentEmp.locationId;
        } else {
          // If viewing another employee's timesheet, check permission
          const emp = await employeeRepo.findById(tx, employeeId);
          if (!emp) return "NOT_FOUND";
          locationId = emp.locationId;
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

        const result = await buildTimesheet(c, tx, {
          employeeId,
          locationId,
          startDate,
          endDate,
        });
        if (!result.ok) return "SCHEDULE_NOT_CONFIGURED" as const;
        return result.summary;
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

        const result = await buildTimesheet(c, tx, {
          employeeId,
          locationId: emp.locationId,
          startDate,
          endDate,
        });
        if (!result.ok) return "SCHEDULE_NOT_CONFIGURED" as const;
        const dailySummaries = result.days;

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
