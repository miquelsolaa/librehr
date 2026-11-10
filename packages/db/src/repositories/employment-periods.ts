import type { TenantTx } from "../with-tenant.js";

/** Local dates (`YYYY-MM-DD`, inclusive); `end` is null while open. */
export interface EmploymentSpan {
  start: string;
  end: string | null;
}

interface PeriodRow {
  employeeId: string;
  terminationDate: string | null;
  hasEmployments: boolean;
  start: string | null;
  end: string | null;
}

/**
 * Employment periods of each employee that overlap a period of local dates
 * (TIM-006), with one query for any number of employees of the current
 * tenant. Per employee:
 * - the `employments` rows overlapping the period, ordered by start, when
 *   the employee has any employment row (possibly none overlap: `[]`);
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
  const result = new Map<string, EmploymentSpan[] | null>();
  if (employeeIds.length === 0) return result;
  const orgId = tx.__tenantContext.organizationId;
  const rows = await tx<PeriodRow[]>`
    SELECT e.id AS "employeeId",
           e.termination_date::text AS "terminationDate",
           EXISTS (
             SELECT 1 FROM employments x
             WHERE x.employee_id = e.id AND x.organization_id = ${orgId}
           ) AS "hasEmployments",
           emp.start_date::text AS "start", emp.end_date::text AS "end"
    FROM employees e
    LEFT JOIN employments emp
      ON emp.employee_id = e.id AND emp.organization_id = ${orgId}
     AND emp.start_date <= ${periodEnd}::date
     AND (emp.end_date IS NULL OR emp.end_date >= ${periodStart}::date)
    WHERE e.organization_id = ${orgId} AND e.id IN ${tx([...employeeIds])}
    ORDER BY e.id, emp.start_date, emp.id
  `;
  for (const row of rows) {
    if (!row.hasEmployments) {
      const left = row.terminationDate;
      result.set(
        row.employeeId,
        left === null
          ? null
          : left < periodStart
            ? []
            : [{ start: periodStart, end: left }],
      );
      continue;
    }
    const spans = result.get(row.employeeId) ?? [];
    if (row.start !== null) spans.push({ start: row.start, end: row.end });
    result.set(row.employeeId, spans);
  }
  return result;
}
