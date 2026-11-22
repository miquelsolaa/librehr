import type { TenantTx } from "../with-tenant.js";

/** Local dates (`YYYY-MM-DD`, inclusive); `end` is null while open. */
export interface EmploymentSpan {
  start: string;
  end: string | null;
}

/**
 * SQL for the effective last day of employment row `x` of employee `e`.
 * Terminating an employee (EMP-007) only sets `employees.termination_date`
 * and leaves the current `employments` row open, so a row that is open, or
 * ends after the termination date, ends on that date instead, as long as it
 * started on or before it. A row that starts after the termination date is a
 * re-hire: the old termination date does not apply to it. Read-side only, so
 * stored rows stay as they are. A constant (no input): safe to inline.
 */
export const EFFECTIVE_EMPLOYMENT_END = `CASE
  WHEN e.termination_date IS NOT NULL
   AND e.termination_date >= x.start_date
   AND (x.end_date IS NULL OR x.end_date > e.termination_date)
  THEN e.termination_date
  ELSE x.end_date
END`;

/** An employment span with its contract's weekly hours (LEA-002). */
export interface EmploymentSpanWithHours extends EmploymentSpan {
  /**
   * `employments.working_hours_per_week` as stored (text), or null for a
   * legacy employee without employment rows (hours unknown).
   */
  hoursPerWeek: string | null;
}

interface PeriodRow {
  employeeId: string;
  terminationDate: string | null;
  hasEmployments: boolean;
  start: string | null;
  end: string | null;
  hoursPerWeek: string | null;
}

async function periodRows(
  tx: TenantTx,
  employeeIds: readonly string[],
  periodStart: string,
  periodEnd: string,
): Promise<PeriodRow[]> {
  const orgId = tx.__tenantContext.organizationId;
  return tx<PeriodRow[]>`
    SELECT e.id AS "employeeId",
           e.termination_date::text AS "terminationDate",
           EXISTS (
             SELECT 1 FROM employments x
             WHERE x.employee_id = e.id AND x.organization_id = ${orgId}
           ) AS "hasEmployments",
           emp.start_date::text AS "start", emp.effective_end::text AS "end",
           emp.working_hours_per_week AS "hoursPerWeek"
    FROM employees e
    LEFT JOIN LATERAL (
      SELECT x.id, x.start_date, x.working_hours_per_week,
             ${tx.unsafe(EFFECTIVE_EMPLOYMENT_END)} AS effective_end
      FROM employments x
      WHERE x.employee_id = e.id AND x.organization_id = ${orgId}
    ) emp
      ON emp.start_date <= ${periodEnd}::date
     AND (emp.effective_end IS NULL OR emp.effective_end >= ${periodStart}::date)
    WHERE e.organization_id = ${orgId} AND e.id IN ${tx([...employeeIds])}
    ORDER BY e.id, emp.start_date, emp.id
  `;
}

function toSpans<T>(
  rows: readonly PeriodRow[],
  periodStart: string,
  span: (row: PeriodRow & { start: string }) => T,
  legacy: (end: string) => T,
): Map<string, T[] | null> {
  const result = new Map<string, T[] | null>();
  for (const row of rows) {
    if (!row.hasEmployments) {
      const left = row.terminationDate;
      result.set(
        row.employeeId,
        left === null ? null : left < periodStart ? [] : [legacy(left)],
      );
      continue;
    }
    const spans = result.get(row.employeeId) ?? [];
    if (row.start !== null) spans.push(span({ ...row, start: row.start }));
    result.set(row.employeeId, spans);
  }
  return result;
}

/**
 * Employment periods of each employee that overlap a period of local dates
 * (TIM-006), with one query for any number of employees of the current
 * tenant. Per employee:
 * - the `employments` rows overlapping the period, ordered by start, when
 *   the employee has any employment row (possibly none overlap: `[]`),
 *   each ending at its effective end (see {@link EFFECTIVE_EMPLOYMENT_END});
 * - otherwise (legacy, hire date unknown) `null` when there is no
 *   termination date, or one span from the period start to the termination
 *   date (`[]` when they left before the period).
 *
 * This is the same rule as `EmployeeRepository.listEmployedDuring`, minus
 * its "recorded work in the period" clause: the export lists that work but
 * flags its days as not employed. Ids of other tenants are absent.
 */
export async function loadEmploymentPeriods(
  tx: TenantTx,
  employeeIds: readonly string[],
  periodStart: string,
  periodEnd: string,
): Promise<Map<string, EmploymentSpan[] | null>> {
  if (employeeIds.length === 0) return new Map();
  return toSpans<EmploymentSpan>(
    await periodRows(tx, employeeIds, periodStart, periodEnd),
    periodStart,
    (row) => ({ start: row.start, end: row.end }),
    (end) => ({ start: periodStart, end }),
  );
}

/**
 * {@link loadEmploymentPeriods}, with each span's weekly contract hours, for
 * part-time proration of leave accrual (LEA-002, issue #118).
 */
export async function loadEmploymentPeriodsWithHours(
  tx: TenantTx,
  employeeIds: readonly string[],
  periodStart: string,
  periodEnd: string,
): Promise<Map<string, EmploymentSpanWithHours[] | null>> {
  if (employeeIds.length === 0) return new Map();
  return toSpans<EmploymentSpanWithHours>(
    await periodRows(tx, employeeIds, periodStart, periodEnd),
    periodStart,
    (row) => ({
      start: row.start,
      end: row.end,
      hoursPerWeek: row.hoursPerWeek,
    }),
    (end) => ({ start: periodStart, end, hoursPerWeek: null }),
  );
}
