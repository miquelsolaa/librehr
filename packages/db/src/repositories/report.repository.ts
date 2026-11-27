import type { TenantTx } from "../with-tenant.js";

/** ORG-007: an employee's link to a department or group on a date. */
export interface HeadcountBreakdownLinkRow {
  employeeId: string;
  targetType: "department" | "project" | "area";
  targetId: string;
  targetName: string;
  /** True for the primary department (employees.department_id). */
  primary: boolean;
  allocationPercent: number | null;
}

export class ReportRepository {
  async getHeadcountSource(tx: TenantTx): Promise<
    {
      id: string;
      startDate: string | null;
      endDate: string | null;
      terminationDate: string | null;
      status: string;
      employmentCount: number;
    }[]
  > {
    return tx`
      SELECT e.id, e.status, e.termination_date::text AS "terminationDate",
             MIN(emp.start_date)::text AS "startDate",
             MIN(emp.end_date)::text AS "endDate",
             COUNT(emp.id)::int AS "employmentCount"
      FROM employees e
      LEFT JOIN employments emp ON emp.employee_id = e.id
        AND emp.organization_id = e.organization_id
      WHERE e.organization_id = ${tx.__tenantContext.organizationId}
      GROUP BY e.id
    `;
  }

  /**
   * ORG-007 (RPT-001): primary departments plus memberships active on
   * `date`, a calendar date in the organization's time zone. The primary is
   * the current one: employees.department_id keeps no history.
   */
  async getHeadcountBreakdownLinks(
    tx: TenantTx,
    date: string,
  ): Promise<HeadcountBreakdownLinkRow[]> {
    const orgId = tx.__tenantContext.organizationId;
    return tx<HeadcountBreakdownLinkRow[]>`
      SELECT e.id AS "employeeId", 'department' AS "targetType",
             d.id AS "targetId", d.name AS "targetName", true AS "primary",
             NULL::float8 AS "allocationPercent"
      FROM employees e
      JOIN departments d
        ON d.id = e.department_id AND d.organization_id = e.organization_id
      WHERE e.organization_id = ${orgId}
      UNION ALL
      SELECT m.employee_id, coalesce(g.kind, 'department'),
             coalesce(m.department_id, m.group_id), coalesce(d.name, g.name),
             false, m.allocation_percent::float8
      FROM employee_memberships m
      LEFT JOIN departments d
        ON d.id = m.department_id AND d.organization_id = m.organization_id
      LEFT JOIN org_groups g
        ON g.id = m.group_id AND g.organization_id = m.organization_id
      WHERE m.organization_id = ${orgId}
        AND m.start_date <= ${date}::date
        AND (m.end_date IS NULL OR m.end_date >= ${date}::date)
    `;
  }
}
