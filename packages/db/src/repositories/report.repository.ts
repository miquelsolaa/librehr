import type { TenantTx } from "../with-tenant.js";

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
}
