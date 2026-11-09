import type { TenantTx } from "../with-tenant.js";

export interface LeaveTypeRow {
  id: string;
  organizationId: string;
  name: string;
  code: string;
  isPaid: boolean;
  requiresApproval: boolean;
  requiresAttachment: boolean;
  legalReference: string | null;
  description: string | null;
  halfDaysAllowed: boolean;
  countsWorkingDays: boolean;
  color: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface LeavePolicyRow {
  id: string;
  organizationId: string;
  leaveTypeId: string;
  name: string;
  annualAllowanceDays: number;
  accrualMethod: string;
  carryoverMaxDays: number;
  carryoverExpiryMonths: number;
  allowNegativeBalance: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface LeaveLedgerRow {
  id: string;
  organizationId: string;
  employeeId: string;
  entryType: string; // accrual, usage, adjustment, carryover, expiry, reversal
  amount: number;
  unit: string;
  sourceRef: string | null;
  note: string | null;
  effectiveDate: string;
  createdAt: Date;
}

export interface LeaveRequestRow {
  id: string;
  organizationId: string;
  employeeId: string;
  employeeName?: string | undefined;
  leaveTypeId: string;
  leaveTypeName?: string | undefined;
  leaveTypeCode?: string | undefined;
  leaveTypeColor?: string | undefined;
  startDate: string;
  endDate: string;
  halfDayStart: boolean;
  halfDayEnd: boolean;
  workingDays: number;
  status: string; // pending, approved, rejected, cancelled
  notes: string | null;
  approverId: string | null;
  approverName?: string | null | undefined;
  decidedAt: Date | null;
  decisionReason: string | null;
  reversalLedgerEntryId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TeamAbsenceRow {
  requestId: string;
  employeeId: string;
  employeeName: string;
  employeeUserId: string | null;
  managerUserId: string | null;
  departmentId: string | null;
  departmentName: string | null;
  startDate: string;
  endDate: string;
  halfDayStart: boolean;
  halfDayEnd: boolean;
  leaveTypeCode: string;
  leaveTypeName: string;
  status: string;
}

export class LeaveRepository {
  async getLeaveTypes(tx: TenantTx): Promise<LeaveTypeRow[]> {
    return tx<LeaveTypeRow[]>`
      SELECT id, organization_id as "organizationId", name, code,
             is_paid as "isPaid", requires_approval as "requiresApproval",
             requires_attachment as "requiresAttachment",
             legal_reference as "legalReference", description,
             half_days_allowed as "halfDaysAllowed", counts_working_days as "countsWorkingDays",
             color, created_at as "createdAt", updated_at as "updatedAt"
      FROM leave_types
      ORDER BY name ASC
    `;
  }

  async createLeaveType(
    tx: TenantTx,
    data: {
      name: string;
      code: string;
      isPaid?: boolean | undefined;
      requiresApproval?: boolean | undefined;
      requiresAttachment?: boolean | undefined;
      legalReference?: string | undefined;
      description?: string | undefined;
      halfDaysAllowed?: boolean | undefined;
      countsWorkingDays?: boolean | undefined;
      color?: string | undefined;
    },
  ): Promise<LeaveTypeRow> {
    const rows = await tx<LeaveTypeRow[]>`
      INSERT INTO leave_types (
        name, code, is_paid, requires_approval,
        requires_attachment, legal_reference, description,
        half_days_allowed, counts_working_days, color
      ) VALUES (
        ${data.name},
        ${data.code},
        ${data.isPaid ?? true},
        ${data.requiresApproval ?? true},
        ${data.requiresAttachment ?? false},
        ${data.legalReference ?? null},
        ${data.description ?? null},
        ${data.halfDaysAllowed ?? true},
        ${data.countsWorkingDays ?? true},
        ${data.color ?? "#3b82f6"}
      )
      RETURNING id, organization_id as "organizationId", name, code,
                is_paid as "isPaid", requires_approval as "requiresApproval",
                requires_attachment as "requiresAttachment",
                legal_reference as "legalReference", description,
                half_days_allowed as "halfDaysAllowed", counts_working_days as "countsWorkingDays",
                color, created_at as "createdAt", updated_at as "updatedAt"
    `;
    return rows[0]!;
  }

  async getLeavePolicies(tx: TenantTx): Promise<LeavePolicyRow[]> {
    return tx<LeavePolicyRow[]>`
      SELECT id, organization_id as "organizationId", leave_type_id as "leaveTypeId",
             name, annual_allowance_days::float as "annualAllowanceDays",
             accrual_method as "accrualMethod", carryover_max_days::float as "carryoverMaxDays",
             carryover_expiry_months as "carryoverExpiryMonths",
             allow_negative_balance as "allowNegativeBalance",
             created_at as "createdAt", updated_at as "updatedAt"
      FROM leave_policies
      ORDER BY name ASC
    `;
  }

  async createLeavePolicy(
    tx: TenantTx,
    data: {
      leaveTypeId: string;
      name: string;
      annualAllowanceDays?: number | undefined;
      accrualMethod?: string | undefined;
      carryoverMaxDays?: number | undefined;
      carryoverExpiryMonths?: number | undefined;
      allowNegativeBalance?: boolean | undefined;
    },
  ): Promise<LeavePolicyRow> {
    const rows = await tx<LeavePolicyRow[]>`
      INSERT INTO leave_policies (
        leave_type_id, name, annual_allowance_days, accrual_method,
        carryover_max_days, carryover_expiry_months, allow_negative_balance
      ) VALUES (
        ${data.leaveTypeId},
        ${data.name},
        ${data.annualAllowanceDays ?? 22.0},
        ${data.accrualMethod ?? "monthly"},
        ${data.carryoverMaxDays ?? 5.0},
        ${data.carryoverExpiryMonths ?? 3},
        ${data.allowNegativeBalance ?? false}
      )
      RETURNING id, organization_id as "organizationId", leave_type_id as "leaveTypeId",
                name, annual_allowance_days::float as "annualAllowanceDays",
                accrual_method as "accrualMethod", carryover_max_days::float as "carryoverMaxDays",
                carryover_expiry_months as "carryoverExpiryMonths",
                allow_negative_balance as "allowNegativeBalance",
                created_at as "createdAt", updated_at as "updatedAt"
    `;
    return rows[0]!;
  }

  async getLedgerEntries(
    tx: TenantTx,
    employeeId: string,
  ): Promise<LeaveLedgerRow[]> {
    return tx<LeaveLedgerRow[]>`
      SELECT id, organization_id as "organizationId", employee_id as "employeeId",
             entry_type as "entryType", amount::float as amount, unit,
             source_ref as "sourceRef", note, effective_date::text as "effectiveDate",
             created_at as "createdAt"
      FROM leave_ledger
      WHERE employee_id = ${employeeId}
      ORDER BY effective_date ASC, created_at ASC
    `;
  }

  async appendLedgerEntry(
    tx: TenantTx,
    data: {
      employeeId: string;
      entryType: string;
      amount: number;
      unit?: string | undefined;
      sourceRef?: string | null | undefined;
      note?: string | null | undefined;
      /** Business date in the employee's location (or organization) zone. */
      effectiveDate: string;
    },
  ): Promise<LeaveLedgerRow> {
    const effectiveDate = data.effectiveDate;
    const rows = await tx<LeaveLedgerRow[]>`
      INSERT INTO leave_ledger (
        employee_id, entry_type, amount, unit,
        source_ref, note, effective_date
      ) VALUES (
        ${data.employeeId},
        ${data.entryType},
        ${data.amount},
        ${data.unit ?? "days"},
        ${data.sourceRef ?? null},
        ${data.note ?? null},
        ${effectiveDate}
      )
      RETURNING id, organization_id as "organizationId", employee_id as "employeeId",
                entry_type as "entryType", amount::float as amount, unit,
                source_ref as "sourceRef", note, effective_date::text as "effectiveDate",
                created_at as "createdAt"
    `;
    return rows[0]!;
  }

  async calculateBalance(
    tx: TenantTx,
    employeeId: string,
  ): Promise<{
    currentBalance: number;
    totalAccrued: number;
    totalUsed: number;
    totalCarryover: number;
    totalAdjustments: number;
  }> {
    const entries = await this.getLedgerEntries(tx, employeeId);
    let totalAccrued = 0;
    let totalUsed = 0;
    let totalCarryover = 0;
    let totalAdjustments = 0;
    let currentBalance = 0;

    for (const e of entries) {
      currentBalance += e.amount;
      if (e.entryType === "accrual") totalAccrued += e.amount;
      else if (e.entryType === "usage") totalUsed += Math.abs(e.amount);
      else if (e.entryType === "carryover") totalCarryover += e.amount;
      else if (e.entryType === "adjustment" || e.entryType === "reversal")
        totalAdjustments += e.amount;
    }

    return {
      currentBalance: Math.round(currentBalance * 100) / 100,
      totalAccrued: Math.round(totalAccrued * 100) / 100,
      totalUsed: Math.round(totalUsed * 100) / 100,
      totalCarryover: Math.round(totalCarryover * 100) / 100,
      totalAdjustments: Math.round(totalAdjustments * 100) / 100,
    };
  }

  async getLeaveRequests(
    tx: TenantTx,
    filters: {
      employeeId?: string | undefined;
      managerEmployeeId?: string | undefined;
      status?: string | undefined;
      year?: number | undefined;
    } = {},
  ): Promise<LeaveRequestRow[]> {
    return tx<LeaveRequestRow[]>`
      SELECT r.id, r.organization_id as "organizationId", r.employee_id as "employeeId",
             CONCAT(e.first_name, ' ', e.last_name) as "employeeName",
             r.leave_type_id as "leaveTypeId", t.name as "leaveTypeName",
             t.code as "leaveTypeCode", t.color as "leaveTypeColor",
             r.start_date::text as "startDate", r.end_date::text as "endDate",
             r.half_day_start as "halfDayStart", r.half_day_end as "halfDayEnd",
             r.working_days::float as "workingDays", r.status, r.notes,
             r.approver_id as "approverId",
             CONCAT(a.first_name, ' ', a.last_name) as "approverName",
             r.decided_at as "decidedAt", r.decision_reason as "decisionReason",
             r.reversal_ledger_entry_id as "reversalLedgerEntryId",
             r.created_at as "createdAt", r.updated_at as "updatedAt"
      FROM leave_requests r
      JOIN employees e ON e.id = r.employee_id
      JOIN leave_types t ON t.id = r.leave_type_id
      LEFT JOIN employees a ON a.id = r.approver_id
      WHERE r.organization_id = ${tx.__tenantContext.organizationId}
        AND e.organization_id = ${tx.__tenantContext.organizationId}
        AND t.organization_id = ${tx.__tenantContext.organizationId}
        AND (${filters.managerEmployeeId ?? null}::uuid IS NULL OR e.manager_id = ${filters.managerEmployeeId ?? null} OR e.id = ${filters.managerEmployeeId ?? null})
        AND (${filters.employeeId ?? null}::uuid IS NULL OR r.employee_id = ${filters.employeeId ?? null})
        AND (${filters.status ?? null}::text IS NULL OR r.status = ${filters.status ?? null})
        AND (${filters.year ?? null}::int IS NULL OR EXTRACT(YEAR FROM r.start_date) = ${filters.year ?? null})
      ORDER BY r.start_date DESC, r.created_at DESC
    `;
  }

  async getLeaveRequestById(
    tx: TenantTx,
    id: string,
  ): Promise<LeaveRequestRow | null> {
    const rows = await tx<LeaveRequestRow[]>`
      SELECT r.id, r.organization_id as "organizationId", r.employee_id as "employeeId",
             CONCAT(e.first_name, ' ', e.last_name) as "employeeName",
             r.leave_type_id as "leaveTypeId", t.name as "leaveTypeName",
             t.code as "leaveTypeCode", t.color as "leaveTypeColor",
             r.start_date::text as "startDate", r.end_date::text as "endDate",
             r.half_day_start as "halfDayStart", r.half_day_end as "halfDayEnd",
             r.working_days::float as "workingDays", r.status, r.notes,
             r.approver_id as "approverId",
             CONCAT(a.first_name, ' ', a.last_name) as "approverName",
             r.decided_at as "decidedAt", r.decision_reason as "decisionReason",
             r.reversal_ledger_entry_id as "reversalLedgerEntryId",
             r.created_at as "createdAt", r.updated_at as "updatedAt"
      FROM leave_requests r
      JOIN employees e ON e.id = r.employee_id
      JOIN leave_types t ON t.id = r.leave_type_id
      LEFT JOIN employees a ON a.id = r.approver_id
      WHERE r.id = ${id}
      LIMIT 1
    `;
    return rows[0] ?? null;
  }

  async createLeaveRequest(
    tx: TenantTx,
    data: {
      employeeId: string;
      leaveTypeId: string;
      startDate: string;
      endDate: string;
      halfDayStart?: boolean | undefined;
      halfDayEnd?: boolean | undefined;
      workingDays: number;
      notes?: string | null | undefined;
    },
  ): Promise<LeaveRequestRow> {
    const rows = await tx<LeaveRequestRow[]>`
      INSERT INTO leave_requests (
        employee_id, leave_type_id, start_date, end_date,
        half_day_start, half_day_end, working_days, notes, status
      ) VALUES (
        ${data.employeeId},
        ${data.leaveTypeId},
        ${data.startDate},
        ${data.endDate},
        ${data.halfDayStart ?? false},
        ${data.halfDayEnd ?? false},
        ${data.workingDays},
        ${data.notes ?? null},
        'pending'
      )
      RETURNING id, organization_id as "organizationId", employee_id as "employeeId",
                leave_type_id as "leaveTypeId", start_date::text as "startDate",
                end_date::text as "endDate", half_day_start as "halfDayStart",
                half_day_end as "halfDayEnd", working_days::float as "workingDays",
                status, notes, approver_id as "approverId", decided_at as "decidedAt",
                decision_reason as "decisionReason", reversal_ledger_entry_id as "reversalLedgerEntryId",
                created_at as "createdAt", updated_at as "updatedAt"
    `;
    const full = await this.getLeaveRequestById(tx, rows[0]!.id);
    return full!;
  }

  async approveLeaveRequest(
    tx: TenantTx,
    id: string,
    approverId: string,
  ): Promise<LeaveRequestRow> {
    const req = await this.getLeaveRequestById(tx, id);
    if (!req) throw new Error("Leave request not found");
    if (req.status !== "pending")
      throw new Error("Only pending requests can be approved");

    // 1. Update request status to approved
    await tx`
      UPDATE leave_requests
      SET status = 'approved', approver_id = ${approverId},
          decided_at = now(), updated_at = now()
      WHERE id = ${id}
    `;

    // 2. Append usage entry to leave_ledger (negative amount)
    await this.appendLedgerEntry(tx, {
      employeeId: req.employeeId,
      entryType: "usage",
      amount: -Math.abs(req.workingDays),
      sourceRef: id,
      note: `Approved leave request ${req.startDate} to ${req.endDate}`,
      effectiveDate: req.startDate,
    });

    const updated = await this.getLeaveRequestById(tx, id);
    return updated!;
  }

  async rejectLeaveRequest(
    tx: TenantTx,
    id: string,
    approverId: string,
    reason?: string | undefined,
  ): Promise<LeaveRequestRow> {
    const req = await this.getLeaveRequestById(tx, id);
    if (!req) throw new Error("Leave request not found");
    if (req.status !== "pending")
      throw new Error("Only pending requests can be rejected");

    await tx`
      UPDATE leave_requests
      SET status = 'rejected', approver_id = ${approverId},
          decision_reason = ${reason ?? null}, decided_at = now(), updated_at = now()
      WHERE id = ${id}
    `;

    const updated = await this.getLeaveRequestById(tx, id);
    return updated!;
  }

  /**
   * `today` is the business date of the cancellation in the employee's
   * location (or organization) time zone; a compensating reversal takes
   * effect on it.
   */
  async cancelLeaveRequest(
    tx: TenantTx,
    id: string,
    cancelledById: string,
    today: string,
  ): Promise<LeaveRequestRow> {
    const req = await this.getLeaveRequestById(tx, id);
    if (!req) throw new Error("Leave request not found");
    if (req.status === "cancelled" || req.status === "rejected") {
      throw new Error("Request cannot be cancelled in current status");
    }

    let reversalEntryId: string | null = null;

    // If request was approved, create compensating reversal entry in leave_ledger
    if (req.status === "approved") {
      const reversal = await this.appendLedgerEntry(tx, {
        employeeId: req.employeeId,
        entryType: "reversal",
        amount: Math.abs(req.workingDays),
        sourceRef: id,
        note: `Compensating reversal for cancelled request ${req.startDate} to ${req.endDate}`,
        effectiveDate: today,
      });
      reversalEntryId = reversal.id;
    }

    await tx`
      UPDATE leave_requests
      SET status = 'cancelled', reversal_ledger_entry_id = ${reversalEntryId},
          decision_reason = ${`Cancelled by ${cancelledById}`}, updated_at = now()
      WHERE id = ${id}
    `;

    const updated = await this.getLeaveRequestById(tx, id);
    return updated!;
  }

  async getTeamAbsences(
    tx: TenantTx,
    options: {
      startDate: string;
      endDate: string;
      departmentId?: string | undefined;
    },
  ): Promise<TeamAbsenceRow[]> {
    return tx<TeamAbsenceRow[]>`
      SELECT r.id as "requestId", r.employee_id as "employeeId",
             CONCAT(e.first_name, ' ', e.last_name) as "employeeName",
             e.user_id as "employeeUserId", manager.user_id as "managerUserId",
             e.department_id as "departmentId", d.name as "departmentName",
             r.start_date::text as "startDate", r.end_date::text as "endDate",
             r.half_day_start as "halfDayStart", r.half_day_end as "halfDayEnd",
             t.code as "leaveTypeCode", t.name as "leaveTypeName",
             r.status
      FROM leave_requests r
      JOIN employees e ON e.id = r.employee_id
      LEFT JOIN employees manager ON manager.id = e.manager_id AND manager.organization_id = ${tx.__tenantContext.organizationId}
      JOIN leave_types t ON t.id = r.leave_type_id
      LEFT JOIN departments d ON d.id = e.department_id
      WHERE r.organization_id = ${tx.__tenantContext.organizationId}
        AND e.organization_id = ${tx.__tenantContext.organizationId}
        AND t.organization_id = ${tx.__tenantContext.organizationId}
        AND r.status = 'approved'
        AND r.start_date <= ${options.endDate}
        AND r.end_date >= ${options.startDate}
        AND (${options.departmentId ?? null}::uuid IS NULL OR e.department_id = ${options.departmentId ?? null})
      ORDER BY r.start_date ASC
    `;
  }

  // LEA-007: Blackout periods
  async createBlackoutPeriod(
    tx: TenantTx,
    data: {
      departmentId?: string | undefined;
      startDate: string;
      endDate: string;
      reason: string;
    },
  ): Promise<{
    id: string;
    organizationId: string;
    departmentId: string | null;
    startDate: string;
    endDate: string;
    reason: string;
    createdAt: Date;
  }> {
    const rows = await tx<
      {
        id: string;
        organizationId: string;
        departmentId: string | null;
        startDate: string;
        endDate: string;
        reason: string;
        createdAt: Date;
      }[]
    >`
      INSERT INTO blackout_periods (
        department_id, start_date, end_date, reason
      ) VALUES (
        ${data.departmentId ?? null},
        ${data.startDate},
        ${data.endDate},
        ${data.reason}
      )
      RETURNING id, organization_id as "organizationId", department_id as "departmentId",
                start_date::text as "startDate", end_date::text as "endDate",
                reason, created_at as "createdAt"
    `;
    return rows[0]!;
  }

  async listBlackoutPeriods(
    tx: TenantTx,
    departmentId?: string | undefined,
  ): Promise<
    {
      id: string;
      organizationId: string;
      departmentId: string | null;
      startDate: string;
      endDate: string;
      reason: string;
      createdAt: Date;
    }[]
  > {
    return tx<
      {
        id: string;
        organizationId: string;
        departmentId: string | null;
        startDate: string;
        endDate: string;
        reason: string;
        createdAt: Date;
      }[]
    >`
      SELECT id, organization_id as "organizationId", department_id as "departmentId",
             start_date::text as "startDate", end_date::text as "endDate",
             reason, created_at as "createdAt"
      FROM blackout_periods
      WHERE (${departmentId ?? null}::uuid IS NULL OR department_id IS NULL OR department_id = ${departmentId ?? null}::uuid)
      ORDER BY start_date ASC
    `;
  }

  // LEA-008: Approval delegations
  async createApprovalDelegation(
    tx: TenantTx,
    data: {
      managerEmployeeId: string;
      delegateEmployeeId: string;
      startDate: string;
      endDate: string;
      reason?: string | undefined;
    },
  ): Promise<{
    id: string;
    organizationId: string;
    managerEmployeeId: string;
    delegateEmployeeId: string;
    startDate: string;
    endDate: string;
    reason: string | null;
    createdAt: Date;
  }> {
    const rows = await tx<
      {
        id: string;
        organizationId: string;
        managerEmployeeId: string;
        delegateEmployeeId: string;
        startDate: string;
        endDate: string;
        reason: string | null;
        createdAt: Date;
      }[]
    >`
      INSERT INTO approval_delegations (
        manager_employee_id, delegate_employee_id, start_date, end_date, reason
      ) VALUES (
        ${data.managerEmployeeId},
        ${data.delegateEmployeeId},
        ${data.startDate},
        ${data.endDate},
        ${data.reason ?? null}
      )
      RETURNING id, organization_id as "organizationId",
                manager_employee_id as "managerEmployeeId",
                delegate_employee_id as "delegateEmployeeId",
                start_date::text as "startDate", end_date::text as "endDate",
                reason, created_at as "createdAt"
    `;
    return rows[0]!;
  }

  async listApprovalDelegations(
    tx: TenantTx,
    employeeId?: string | undefined,
  ): Promise<
    {
      id: string;
      organizationId: string;
      managerEmployeeId: string;
      delegateEmployeeId: string;
      managerName?: string;
      delegateName?: string;
      startDate: string;
      endDate: string;
      reason: string | null;
      createdAt: Date;
    }[]
  > {
    return tx<
      {
        id: string;
        organizationId: string;
        managerEmployeeId: string;
        delegateEmployeeId: string;
        managerName: string;
        delegateName: string;
        startDate: string;
        endDate: string;
        reason: string | null;
        createdAt: Date;
      }[]
    >`
      SELECT ad.id, ad.organization_id as "organizationId",
             ad.manager_employee_id as "managerEmployeeId",
             ad.delegate_employee_id as "delegateEmployeeId",
             CONCAT(m.first_name, ' ', m.last_name) as "managerName",
             CONCAT(d.first_name, ' ', d.last_name) as "delegateName",
             ad.start_date::text as "startDate", ad.end_date::text as "endDate",
             ad.reason, ad.created_at as "createdAt"
      FROM approval_delegations ad
      JOIN employees m ON m.id = ad.manager_employee_id
      JOIN employees d ON d.id = ad.delegate_employee_id
      WHERE (${employeeId ?? null}::uuid IS NULL
             OR ad.manager_employee_id = ${employeeId ?? null}::uuid
             OR ad.delegate_employee_id = ${employeeId ?? null}::uuid)
      ORDER BY ad.start_date DESC
    `;
  }

  async getActiveDelegationsForDelegate(
    tx: TenantTx,
    delegateEmployeeId: string,
    onDate: string,
  ): Promise<{ managerEmployeeId: string }[]> {
    return tx<{ managerEmployeeId: string }[]>`
      SELECT manager_employee_id as "managerEmployeeId"
      FROM approval_delegations
      WHERE delegate_employee_id = ${delegateEmployeeId}
        AND start_date <= ${onDate}
        AND end_date >= ${onDate}
    `;
  }
}
