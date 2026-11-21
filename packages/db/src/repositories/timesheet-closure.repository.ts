import type { TenantTx } from "../with-tenant.js";

export type TimesheetClosureAction = "close" | "reopen";

export interface TimesheetClosureRow {
  id: string;
  organizationId: string;
  employeeId: string;
  periodStart: string;
  periodEnd: string;
  action: TimesheetClosureAction;
  /** PeriodTimesheetSummary snapshot of a close; null for a reopen. */
  totals: Record<string, unknown> | null;
  reason: string | null;
  actorId: string;
  createdAt: Date;
}

export interface TimesheetClosureListRow extends TimesheetClosureRow {
  firstName: string;
  lastName: string;
}

export interface PostCloseEventRow {
  id: string;
  refEventId: string | null;
  createdAt: Date;
}

const columns = (tx: TenantTx) => tx`
  id, organization_id as "organizationId", employee_id as "employeeId",
  period_start::text as "periodStart", period_end::text as "periodEnd",
  action, totals, reason, actor_id as "actorId", created_at as "createdAt"
`;

// postgres.js may hand jsonb back as text, depending on how it was written.
function parseTotals(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return value as Record<string, unknown>;
}

const normalize = (row: TimesheetClosureRow): TimesheetClosureRow => ({
  ...row,
  totals: parseTotals(row.totals),
});

/**
 * TIM-004 (#31): append-only month close/reopen log. The newest row per
 * employee and period is the current state.
 */
export class TimesheetClosureRepository {
  /**
   * Serializes close/reopen of one employee's period until the transaction
   * ends, so two concurrent requests cannot both close the same month.
   */
  async lockPeriod(
    tx: TenantTx,
    employeeId: string,
    periodStart: string,
  ): Promise<void> {
    await tx`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`timesheet_closure:${employeeId}:${periodStart}`}, 0)
      )`;
  }

  /** Newest row for one employee and period, or null when never closed. */
  async findLatest(
    tx: TenantTx,
    employeeId: string,
    periodStart: string,
  ): Promise<TimesheetClosureRow | null> {
    const rows = await tx<TimesheetClosureRow[]>`
      SELECT ${columns(tx)}
      FROM timesheet_closures
      WHERE employee_id = ${employeeId} AND period_start = ${periodStart}::date
      ORDER BY created_at DESC, id DESC
      LIMIT 1`;
    return rows[0] ? normalize(rows[0]) : null;
  }

  /**
   * Newest row of every employee with a closure history for a period, with
   * the employee's name for the admin listing.
   */
  async listLatestForPeriod(
    tx: TenantTx,
    periodStart: string,
  ): Promise<TimesheetClosureListRow[]> {
    const rows = await tx<TimesheetClosureListRow[]>`
      SELECT latest.*, e.first_name as "firstName", e.last_name as "lastName"
      FROM (
        SELECT DISTINCT ON (employee_id) ${columns(tx)}
        FROM timesheet_closures
        WHERE period_start = ${periodStart}::date
        ORDER BY employee_id, created_at DESC, id DESC
      ) latest
      JOIN employees e ON e.id = latest."employeeId"
      ORDER BY e.last_name, e.first_name, latest."employeeId"`;
    return rows.map((row) => ({ ...row, totals: parseTotals(row.totals) }));
  }

  async create(
    tx: TenantTx,
    data: {
      employeeId: string;
      periodStart: string;
      periodEnd: string;
      action: TimesheetClosureAction;
      totals: Record<string, unknown> | null;
      reason: string | null;
      actorId: string;
    },
  ): Promise<TimesheetClosureRow> {
    const rows = await tx<TimesheetClosureRow[]>`
      INSERT INTO timesheet_closures (
        employee_id, period_start, period_end, action, totals, reason, actor_id
      ) VALUES (
        ${data.employeeId},
        ${data.periodStart}::date,
        ${data.periodEnd}::date,
        ${data.action},
        ${data.totals ? tx.json(data.totals as never) : null},
        ${data.reason},
        ${data.actorId}
      )
      RETURNING ${columns(tx)}`;
    return normalize(rows[0]!);
  }

  /**
   * Time events of the employee recorded after a close (compared in the
   * database, at full timestamp precision) that occurred in `[from, to)` or
   * correct an event that did.
   */
  async listEventsAfterClose(
    tx: TenantTx,
    closureId: string,
    employeeId: string,
    from: string,
    to: string,
  ): Promise<PostCloseEventRow[]> {
    return tx<PostCloseEventRow[]>`
      SELECT e.id, e.ref_event_id as "refEventId", e.created_at as "createdAt"
      FROM time_events e
      JOIN timesheet_closures c ON c.id = ${closureId}
      WHERE e.employee_id = ${employeeId}
        AND e.created_at > c.created_at
        AND (
          (e.occurred_at >= ${from}::timestamptz AND e.occurred_at < ${to}::timestamptz)
          OR EXISTS (
            SELECT 1 FROM time_events o
            WHERE o.id = e.ref_event_id
              AND o.employee_id = ${employeeId}
              AND o.occurred_at >= ${from}::timestamptz
              AND o.occurred_at < ${to}::timestamptz
          )
        )
      ORDER BY e.created_at ASC, e.id ASC`;
  }
}
