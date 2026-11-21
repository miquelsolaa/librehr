import type { TenantTx } from "../with-tenant.js";

/** One policy assignment, with the policy it points to (LEA-002). */
export interface AccrualAssignmentRow {
  assignmentId: string;
  employeeId: string;
  /** Null when the policy is missing or belongs to another tenant. */
  policyId: string | null;
  annualAllowanceDays: number | null;
  accrualMethod: string | null;
  /** `effective_from` of the assignment (local date). */
  start: string;
  /**
   * Day before the next assignment of the same employee and leave type, or
   * null while this is the latest one.
   */
  end: string | null;
}

/** Reads and writes of the periodic leave accrual job (LEA-002). */
export class LeaveAccrualRepository {
  /**
   * Assignments of the current tenant that apply on some day of
   * [from, to]. An assignment stays in force until the next assignment for
   * the same employee and leave type takes over.
   */
  async listAssignmentsOverlapping(
    tx: TenantTx,
    from: string,
    to: string,
  ): Promise<AccrualAssignmentRow[]> {
    const orgId = tx.__tenantContext.organizationId;
    return tx<AccrualAssignmentRow[]>`
      SELECT w.assignment_id AS "assignmentId", w.employee_id AS "employeeId",
             w.policy_id AS "policyId",
             w.annual_allowance_days AS "annualAllowanceDays",
             w.accrual_method AS "accrualMethod",
             w.start_date::text AS "start", w.end_date::text AS "end"
      FROM (
        SELECT a.id AS assignment_id, a.employee_id, p.id AS policy_id,
               p.annual_allowance_days::float AS annual_allowance_days,
               p.accrual_method, a.effective_from AS start_date,
               LEAD(a.effective_from) OVER (
                 PARTITION BY a.employee_id, p.leave_type_id
                 ORDER BY a.effective_from, a.created_at, a.id
               ) - 1 AS end_date
        FROM leave_policy_assignments a
        LEFT JOIN leave_policies p
          ON p.id = a.leave_policy_id AND p.organization_id = ${orgId}
        WHERE a.organization_id = ${orgId}
      ) w
      WHERE w.start_date <= ${to}::date
        AND (w.end_date IS NULL OR w.end_date >= ${from}::date)
        -- A same-day replacement leaves an empty window (end before start).
        AND (w.end_date IS NULL OR w.end_date >= w.start_date)
      ORDER BY w.employee_id, w.start_date, w.assignment_id
    `;
  }

  /**
   * Accrual already in the ledger for each employee and policy in `year`, in
   * integer cents of a day. Entries are matched by their source reference,
   * `accrual:<policyId>:<YYYY-MM>`, so a policy's total ignores other
   * policies of the same employee.
   */
  async listAccruedCents(
    tx: TenantTx,
    year: number,
  ): Promise<{ employeeId: string; policyId: string; cents: number }[]> {
    const orgId = tx.__tenantContext.organizationId;
    return tx<{ employeeId: string; policyId: string; cents: number }[]>`
      SELECT employee_id AS "employeeId",
             split_part(source_ref, ':', 2) AS "policyId",
             SUM(round(amount * 100))::int AS cents
      FROM leave_ledger
      WHERE organization_id = ${orgId}
        AND entry_type = 'accrual'
        AND source_ref LIKE ${`accrual:%:${year}-%`}
      GROUP BY 1, 2
    `;
  }

  /**
   * Appends an accrual entry once: a second insert with the same employee
   * and `sourceRef` is ignored (unique index `leave_ledger_accrual_once`).
   * Returns false when the entry already existed.
   */
  async appendAccrualOnce(
    tx: TenantTx,
    data: {
      employeeId: string;
      amount: number;
      sourceRef: string;
      /** Business date in the organization's zone. */
      effectiveDate: string;
    },
  ): Promise<boolean> {
    const rows = await tx<{ id: string }[]>`
      INSERT INTO leave_ledger (
        employee_id, entry_type, amount, unit, source_ref, effective_date
      ) VALUES (
        ${data.employeeId}, 'accrual', ${data.amount}, 'days',
        ${data.sourceRef}, ${data.effectiveDate}
      )
      ON CONFLICT (organization_id, employee_id, source_ref)
        WHERE entry_type = 'accrual'
      DO NOTHING
      RETURNING id
    `;
    return rows.length > 0;
  }
}
