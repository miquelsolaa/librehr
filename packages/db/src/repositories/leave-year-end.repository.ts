import type { TenantTx } from "../with-tenant.js";

/** The policy in force on one day for an employee and leave type (LEA-002). */
export interface PolicyInForceRow {
  employeeId: string;
  /** Null when the assignment's policy is missing or another tenant's. */
  policyId: string | null;
  leaveTypeId: string | null;
  carryoverMaxDays: number | null;
  carryoverExpiryMonths: number | null;
}

/** A typed ledger entry, as read for a year-end close (LEA-005). */
export interface YearEndLedgerRow {
  employeeId: string;
  leaveTypeId: string;
  entryType: string;
  amount: number;
  sourceRef: string | null;
  effectiveDate: string;
}

/**
 * Reads and writes of the year-end close and carry-over expiry run by the
 * leave.accrue job (LEA-002, issue #116). Every query is scoped to the
 * current tenant and runs under RLS.
 */
export class LeaveYearEndRepository {
  /**
   * The policy assignment in force on `date` for each employee and leave
   * type: the latest assignment effective on or before that day (same window
   * rule as `LeaveAccrualRepository.listAssignmentsOverlapping`).
   */
  async listPoliciesInForce(
    tx: TenantTx,
    date: string,
  ): Promise<PolicyInForceRow[]> {
    const orgId = tx.__tenantContext.organizationId;
    return tx<PolicyInForceRow[]>`
      SELECT w.employee_id AS "employeeId", w.policy_id AS "policyId",
             w.leave_type_id AS "leaveTypeId",
             w.carryover_max_days AS "carryoverMaxDays",
             w.carryover_expiry_months AS "carryoverExpiryMonths"
      FROM (
        SELECT a.employee_id, p.id AS policy_id, p.leave_type_id,
               p.carryover_max_days::float AS carryover_max_days,
               p.carryover_expiry_months,
               a.effective_from AS start_date,
               LEAD(a.effective_from) OVER (
                 PARTITION BY a.employee_id, p.leave_type_id
                 ORDER BY a.effective_from, a.created_at, a.id
               ) - 1 AS end_date
        FROM leave_policy_assignments a
        LEFT JOIN leave_policies p
          ON p.id = a.leave_policy_id AND p.organization_id = ${orgId}
        WHERE a.organization_id = ${orgId}
      ) w
      WHERE w.start_date <= ${date}::date
        AND (w.end_date IS NULL OR w.end_date >= ${date}::date)
      ORDER BY w.employee_id, w.leave_type_id
    `;
  }

  /**
   * Ledger entries with a leave type dated on or before `date`, for the
   * given employees. Unassigned (legacy) entries are left out: they are
   * never closed.
   */
  async listTypedEntriesUpTo(
    tx: TenantTx,
    employeeIds: readonly string[],
    date: string,
  ): Promise<YearEndLedgerRow[]> {
    if (employeeIds.length === 0) return [];
    const orgId = tx.__tenantContext.organizationId;
    return tx<YearEndLedgerRow[]>`
      SELECT employee_id AS "employeeId", leave_type_id AS "leaveTypeId",
             entry_type AS "entryType", amount::float AS amount,
             source_ref AS "sourceRef", effective_date::text AS "effectiveDate"
      FROM leave_ledger
      WHERE organization_id = ${orgId}
        AND leave_type_id IS NOT NULL
        AND effective_date <= ${date}::date
        AND employee_id IN ${tx([...employeeIds])}
    `;
  }

  /**
   * Days carried over from `year` (the +C entry,
   * `carryover:<leaveTypeId>:<YYYY>`) that have no expiry entry yet, in
   * integer cents.
   */
  async listUnexpiredCarryovers(
    tx: TenantTx,
    year: number,
  ): Promise<
    { employeeId: string; leaveTypeId: string; carriedCents: number }[]
  > {
    const orgId = tx.__tenantContext.organizationId;
    return tx<
      { employeeId: string; leaveTypeId: string; carriedCents: number }[]
    >`
      SELECT c.employee_id AS "employeeId", c.leave_type_id AS "leaveTypeId",
             round(c.amount * 100)::int AS "carriedCents"
      FROM leave_ledger c
      WHERE c.organization_id = ${orgId}
        AND c.entry_type = 'carryover'
        AND c.leave_type_id IS NOT NULL
        AND c.amount > 0
        AND c.source_ref = 'carryover:' || c.leave_type_id::text || ':' || ${String(year)}
        AND NOT EXISTS (
          SELECT 1 FROM leave_ledger x
          WHERE x.organization_id = c.organization_id
            AND x.employee_id = c.employee_id
            AND x.entry_type = 'expiry'
            AND x.source_ref = 'expiry:' || c.leave_type_id::text || ':' || ${String(year)}
        )
    `;
  }

  /**
   * Days used per employee and leave type by requests that start in
   * [from, to], in integer cents: their `usage` entries plus the `reversal`
   * entries of the same requests (a cancelled request uses nothing, whenever
   * it was cancelled). Negative values are possible only with hand-written
   * rows; callers floor them at 0.
   */
  async listNetUsageCents(
    tx: TenantTx,
    from: string,
    to: string,
  ): Promise<{ employeeId: string; leaveTypeId: string; usedCents: number }[]> {
    const orgId = tx.__tenantContext.organizationId;
    return tx<{ employeeId: string; leaveTypeId: string; usedCents: number }[]>`
      SELECT l.employee_id AS "employeeId", l.leave_type_id AS "leaveTypeId",
             (-SUM(round(l.amount * 100)))::int AS "usedCents"
      FROM leave_ledger l
      WHERE l.organization_id = ${orgId}
        AND l.leave_type_id IS NOT NULL
        AND (
          (l.entry_type = 'usage'
            AND l.effective_date BETWEEN ${from}::date AND ${to}::date)
          OR (l.entry_type = 'reversal' AND EXISTS (
            SELECT 1 FROM leave_ledger u
            WHERE u.organization_id = l.organization_id
              AND u.employee_id = l.employee_id
              AND u.entry_type = 'usage'
              AND u.source_ref = l.source_ref
              AND u.effective_date BETWEEN ${from}::date AND ${to}::date
          ))
        )
      GROUP BY 1, 2
    `;
  }

  /**
   * Appends a carry-over, forfeit or expiry entry once: a second insert with
   * the same employee and `sourceRef` is ignored (unique index
   * `leave_ledger_year_end_once`, migration 0036). Returns false when the
   * entry already existed.
   */
  async appendYearEndOnce(
    tx: TenantTx,
    data: {
      employeeId: string;
      leaveTypeId: string;
      entryType: "carryover" | "forfeit" | "expiry";
      amount: number;
      sourceRef: string;
      /** Business date in the organization's zone. */
      effectiveDate: string;
    },
  ): Promise<boolean> {
    const rows = await tx<{ id: string }[]>`
      INSERT INTO leave_ledger (
        employee_id, leave_type_id, entry_type, amount, unit, source_ref,
        effective_date
      ) VALUES (
        ${data.employeeId}, ${data.leaveTypeId}, ${data.entryType},
        ${data.amount}, 'days', ${data.sourceRef}, ${data.effectiveDate}
      )
      ON CONFLICT (organization_id, employee_id, source_ref)
        WHERE entry_type IN ('carryover', 'forfeit', 'expiry')
      DO NOTHING
      RETURNING id
    `;
    return rows.length > 0;
  }
}
