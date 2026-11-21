import { Hono, type Context } from "hono";
import type { Sql } from "postgres";
import {
  type AuthUser,
  type CloseTimesheetPeriodResponse,
  type CloseTimesheetPeriodResult,
  type TimesheetClosureItem,
  type TimesheetClosuresResponse,
  CloseTimesheetPeriodRequestSchema,
  ReopenTimesheetPeriodRequestSchema,
  TimesheetClosuresQuerySchema,
} from "@librehr/contracts";
import {
  monthContaining,
  monthPeriod,
  type PeriodTimesheetSummary,
} from "@librehr/core";
import {
  withTenant,
  AuditRepository,
  EmployeeRepository,
  TimesheetClosureRepository,
  type TenantTx,
  type TimesheetClosureRow,
} from "@librehr/db";
import { requireAuth } from "../middleware/auth.js";
import { employeeIdsInScope, permissionScope } from "../policies/can.js";
import type { PolicyUserContext } from "../policies/can.js";
import {
  requireEmployeesInScope,
  requireEmployeeInScope,
  resolvePolicyContext,
} from "../policies/context.js";
import {
  ConflictError,
  ForbiddenError,
  ValidationError,
} from "../errors/index.js";
import { parseJsonBody, parseQuery } from "../lib/validate.js";
import { businessToday } from "../lib/business-date.js";
import { buildTimesheet } from "../lib/timesheet.js";
import { closureTotals } from "../lib/timesheet-closure.js";

const PERMISSION = "time.period.close" as const;

/** Most employees one close request may snapshot (one timesheet each). */
export const MAX_CLOSE_EMPLOYEES = 1000;

const currentUser = (c: { get: unknown }) =>
  (c.get as (key: string) => unknown)("user") as AuthUser;

function requireClosePermission(ctx: PolicyUserContext): void {
  if (!permissionScope(ctx, PERMISSION)) {
    throw new ForbiddenError({
      detail: "You do not have permission to close timesheet periods",
    });
  }
}

/**
 * A month can be closed once it has ended in the organization's zone: a
 * snapshot of a month in progress would be partial, and every ordinary
 * clocking for the rest of it would be flagged as a post-close change.
 */
async function requireEndedMonth(
  c: Context,
  tx: TenantTx,
  month: string,
): Promise<void> {
  const today = await businessToday(c, tx);
  const current = monthContaining(today, today);
  // Both are zero-padded YYYY-MM, so string order is calendar order.
  if (current !== null && month >= current) {
    throw new ValidationError({
      status: 422,
      code: "PERIOD_NOT_ENDED",
      detail: "A month can only be closed once it has ended",
    });
  }
}

/**
 * The stored snapshot: period and per-day totals, without the sessions'
 * clock instants, which stay in time_events (data minimisation).
 */
function snapshotTotals(summary: PeriodTimesheetSummary) {
  return {
    totalWorkedMinutes: summary.totalWorkedMinutes,
    totalBreakMinutes: summary.totalBreakMinutes,
    totalExpectedHours: summary.totalExpectedHours,
    totalOvertimeMinutes: summary.totalOvertimeMinutes,
    days: summary.days.map((day) => ({
      date: day.date,
      totalWorkedMinutes: day.totalWorkedMinutes,
      totalBreakMinutes: day.totalBreakMinutes,
      expectedHours: day.expectedHours,
      overtimeMinutes: day.overtimeMinutes,
      hasAnomaly: day.hasAnomaly,
    })),
  };
}

function toItem(
  row: TimesheetClosureRow,
  employeeName: string,
): TimesheetClosureItem {
  const closed = row.action === "close";
  return {
    employeeId: row.employeeId,
    employeeName,
    status: closed ? "closed" : "reopened",
    at: row.createdAt.toISOString(),
    actorId: row.actorId,
    totals: closed ? closureTotals(row.totals) : null,
    reason: closed ? null : row.reason,
  };
}

/**
 * TIM-004 (#31): monthly timesheet closure. Closing snapshots each
 * employee's month (local calendar days in their business zone); reopening
 * needs a reason. Both are append-only and audited (ADM-002). Corrections
 * after a close are never blocked: GET /time/timesheet flags them.
 */
export function createTimeClosureRoutes(sql: Sql) {
  const router = new Hono();
  const employeeRepo = new EmployeeRepository();
  const closureRepo = new TimesheetClosureRepository();
  const auditRepo = new AuditRepository();

  router.post("/time/closures", requireAuth, async (c) => {
    const user = currentUser(c);
    const body = await parseJsonBody(c, CloseTimesheetPeriodRequestSchema);
    const period = monthPeriod(body.month);

    const results = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        const ctx = await resolvePolicyContext(c, tx);
        requireClosePermission(ctx);
        await requireEndedMonth(c, tx, body.month);

        let subjects: { id: string; locationId: string | null }[];
        if (body.employeeIds) {
          const loaded = new Map<
            string,
            { id: string; locationId: string | null }
          >();
          await requireEmployeesInScope(
            ctx,
            PERMISSION,
            body.employeeIds,
            async (id) => {
              const emp = await employeeRepo.findById(tx, id);
              if (emp) loaded.set(id, emp);
              return emp;
            },
          );
          subjects = [...loaded.values()];
        } else {
          const inScope = employeeIdsInScope(ctx, PERMISSION);
          const allowed = inScope === "all" ? null : new Set(inScope);
          const employed = await employeeRepo.listEmployedDuring(
            tx,
            period.startDate,
            period.endDate,
          );
          subjects = employed.filter(
            (e) => allowed === null || allowed.has(e.id),
          );
        }
        if (subjects.length > MAX_CLOSE_EMPLOYEES) {
          throw new ValidationError({
            status: 422,
            code: "CLOSE_TOO_LARGE",
            detail: `Close at most ${MAX_CLOSE_EMPLOYEES} employees per request; pass employeeIds in batches`,
          });
        }

        const out: CloseTimesheetPeriodResult[] = [];
        for (const subject of subjects) {
          await closureRepo.lockPeriod(tx, subject.id, period.startDate);
          const latest = await closureRepo.findLatest(
            tx,
            subject.id,
            period.startDate,
          );
          if (latest?.action === "close") {
            out.push({
              employeeId: subject.id,
              status: "already_closed",
              closedAt: latest.createdAt.toISOString(),
            });
            continue;
          }
          // Read before the snapshot, so a concurrent clocking can only be
          // flagged needlessly, never missed (see chainHighWaterMark).
          const lastEventSeq = await closureRepo.chainHighWaterMark(
            tx,
            subject.id,
          );
          const { timesheet, timeZone } = await buildTimesheet(c, tx, {
            employeeId: subject.id,
            locationId: subject.locationId,
            startDate: period.startDate,
            endDate: period.endDate,
          });
          if (!timesheet.ok) {
            out.push({
              employeeId: subject.id,
              status: "schedule_not_configured",
              closedAt: null,
            });
            continue;
          }
          const row = await closureRepo.create(tx, {
            employeeId: subject.id,
            periodStart: period.startDate,
            periodEnd: period.endDate,
            action: "close",
            totals: snapshotTotals(timesheet.summary),
            lastEventSeq,
            timeZone,
            reason: null,
            actorId: user.id,
          });
          await auditRepo.log(tx, {
            actorId: user.id,
            action: "time.period.close",
            resourceType: "timesheet_closure",
            resourceId: row.id,
            metadata: {
              employeeId: subject.id,
              periodStart: period.startDate,
              periodEnd: period.endDate,
            },
          });
          out.push({
            employeeId: subject.id,
            status: "closed",
            closedAt: row.createdAt.toISOString(),
          });
        }
        return out;
      },
    );

    const response: CloseTimesheetPeriodResponse = {
      month: body.month,
      periodStart: period.startDate,
      periodEnd: period.endDate,
      results,
    };
    return c.json(response, 200);
  });

  router.post("/time/closures/reopen", requireAuth, async (c) => {
    const user = currentUser(c);
    const body = await parseJsonBody(c, ReopenTimesheetPeriodRequestSchema);
    const period = monthPeriod(body.month);

    const item = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        const ctx = await resolvePolicyContext(c, tx);
        requireClosePermission(ctx);
        const emp = await requireEmployeeInScope(ctx, PERMISSION, () =>
          employeeRepo.findById(tx, body.employeeId),
        );
        await closureRepo.lockPeriod(tx, emp.id, period.startDate);
        const latest = await closureRepo.findLatest(
          tx,
          emp.id,
          period.startDate,
        );
        if (latest?.action !== "close") {
          throw new ConflictError({
            code: "PERIOD_NOT_CLOSED",
            detail: "This month is not closed for the employee",
          });
        }
        const row = await closureRepo.create(tx, {
          employeeId: emp.id,
          periodStart: period.startDate,
          periodEnd: period.endDate,
          action: "reopen",
          totals: null,
          lastEventSeq: null,
          timeZone: null,
          reason: body.reason,
          actorId: user.id,
        });
        // The reason is free text and may name people: ids only here.
        await auditRepo.log(tx, {
          actorId: user.id,
          action: "time.period.reopen",
          resourceType: "timesheet_closure",
          resourceId: row.id,
          metadata: {
            employeeId: emp.id,
            periodStart: period.startDate,
            periodEnd: period.endDate,
          },
        });
        return toItem(row, `${emp.firstName} ${emp.lastName}`);
      },
    );
    return c.json(item, 200);
  });

  router.get("/time/closures", requireAuth, async (c) => {
    const user = currentUser(c);
    const { month } = parseQuery(c, TimesheetClosuresQuerySchema);
    const period = monthPeriod(month);

    const items = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        const ctx = await resolvePolicyContext(c, tx);
        requireClosePermission(ctx);
        const inScope = employeeIdsInScope(ctx, PERMISSION);
        const allowed = inScope === "all" ? null : new Set(inScope);
        const rows = await closureRepo.listLatestForPeriod(
          tx,
          period.startDate,
        );
        return rows
          .filter((row) => allowed === null || allowed.has(row.employeeId))
          .map((row) => toItem(row, `${row.firstName} ${row.lastName}`));
      },
    );

    const response: TimesheetClosuresResponse = {
      month,
      periodStart: period.startDate,
      periodEnd: period.endDate,
      items,
    };
    return c.json(response, 200, { "Cache-Control": "no-store" });
  });

  return router;
}
