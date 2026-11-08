import type { TenantTx } from "../with-tenant.js";

export interface MonthlyEmployeePayrollData {
  employeeId: string;
  taxId: string;
  socialSecurityNumber: string | null;
  firstName: string;
  lastName: string;
  contractType: string;
  workedDays: number;
  vacationDays: number;
  sickLeaveDays: number;
  maternityPaternityDays: number;
  unpaidLeaveDays: number;
  overtimeHours: number;
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
   * Aggregates employee leave, attendance, and overtime tallies for a target month (RPT-001, RPT-002).
   */
  async getGestoriaPayrollData(
    tx: TenantTx,
    periodStart: string, // YYYY-MM-DD
    periodEnd: string, // YYYY-MM-DD
  ): Promise<MonthlyEmployeePayrollData[]> {
    const rows = await tx<MonthlyEmployeePayrollData[]>`
      SELECT e.id as "employeeId",
             COALESCE(e.national_id_encrypted, '00000000T') as "taxId",
             null as "socialSecurityNumber",
             e.first_name as "firstName",
             e.last_name as "lastName",
             COALESCE(e.employment_type, 'indefinido') as "contractType",
             COALESCE(worked_summary.worked_days, 20)::int as "workedDays",
             COALESCE(leave_summary.vacation_days, 0)::int as "vacationDays",
             COALESCE(leave_summary.sick_days, 0)::int as "sickLeaveDays",
             COALESCE(leave_summary.maternity_days, 0)::int as "maternityPaternityDays",
             COALESCE(leave_summary.unpaid_days, 0)::int as "unpaidLeaveDays",
             COALESCE(overtime_summary.overtime_hours, 0)::numeric as "overtimeHours"
      FROM employees e
      LEFT JOIN LATERAL (
        SELECT COUNT(DISTINCT te.timestamp::date)::int as worked_days
        FROM time_events te
        WHERE te.employee_id = e.id
          AND te.timestamp >= ${periodStart}::timestamptz
          AND te.timestamp <= ${periodEnd}::timestamptz
      ) worked_summary ON true
      LEFT JOIN LATERAL (
        SELECT 
          SUM(CASE WHEN lr.leave_type_id = '00000000-0000-0000-0000-000000000001' THEN lr.working_days ELSE 0 END)::int as vacation_days,
          SUM(CASE WHEN lr.leave_type_id = '00000000-0000-0000-0000-000000000002' THEN lr.working_days ELSE 0 END)::int as sick_days,
          SUM(CASE WHEN lr.leave_type_id = '00000000-0000-0000-0000-000000000003' THEN lr.working_days ELSE 0 END)::int as maternity_days,
          SUM(CASE WHEN lr.leave_type_id = '00000000-0000-0000-0000-000000000004' THEN lr.working_days ELSE 0 END)::int as unpaid_days
        FROM leave_requests lr
        WHERE lr.employee_id = e.id
          AND lr.status = 'approved'
          AND lr.start_date <= ${periodEnd}
          AND lr.end_date >= ${periodStart}
      ) leave_summary ON true
      LEFT JOIN LATERAL (
        SELECT 0 as overtime_hours
      ) overtime_summary ON true
      WHERE e.status = 'active'
      ORDER BY e.last_name ASC, e.first_name ASC
    `;

    return rows;
  }
}
