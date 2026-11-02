import type { TenantTx } from "../with-tenant.js";

export interface ShiftTemplateRow {
  id: string;
  organizationId: string;
  name: string;
  code: string;
  type: string;
  startTime: string;
  endTime: string;
  color: string;
  breakMinutes: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ShiftPatternRow {
  id: string;
  organizationId: string;
  name: string;
  cycleDays: number;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ShiftPatternStepRow {
  id: string;
  organizationId: string;
  patternId: string;
  stepOrder: number;
  shiftTemplateId: string | null;
  isRest: boolean;
  shiftCode?: string;
  shiftName?: string;
}

export interface ShiftAssignmentRow {
  id: string;
  organizationId: string;
  employeeId: string;
  employeeName?: string;
  date: string;
  shiftTemplateId: string | null;
  shiftCode?: string;
  shiftName?: string;
  shiftType?: string;
  startTime?: string;
  endTime?: string;
  color?: string;
  status: string;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ShiftSwapRow {
  id: string;
  organizationId: string;
  requesterId: string;
  requesterName?: string;
  targetEmployeeId: string;
  targetEmployeeName?: string;
  requesterDate: string;
  targetDate: string;
  status: string;
  reason: string | null;
  approverId: string | null;
  decidedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export class ShiftRepository {
  async getShiftTemplates(tx: TenantTx): Promise<ShiftTemplateRow[]> {
    return tx<ShiftTemplateRow[]>`
      SELECT id, organization_id as "organizationId", name, code, type,
             start_time as "startTime", end_time as "endTime", color,
             break_minutes as "breakMinutes",
             created_at as "createdAt", updated_at as "updatedAt"
      FROM shift_templates
      ORDER BY code ASC
    `;
  }

  async createShiftTemplate(
    tx: TenantTx,
    data: {
      name: string;
      code: string;
      type: string;
      startTime: string;
      endTime: string;
      color?: string;
      breakMinutes?: number;
    },
  ): Promise<ShiftTemplateRow> {
    const rows = await tx<ShiftTemplateRow[]>`
      INSERT INTO shift_templates (
        name, code, type, start_time, end_time, color, break_minutes
      )
      VALUES (
        ${data.name},
        ${data.code},
        ${data.type},
        ${data.startTime},
        ${data.endTime},
        ${data.color ?? "#3b82f6"},
        ${data.breakMinutes ?? 30}
      )
      RETURNING id, organization_id as "organizationId", name, code, type,
                start_time as "startTime", end_time as "endTime", color,
                break_minutes as "breakMinutes",
                created_at as "createdAt", updated_at as "updatedAt"
    `;
    return rows[0]!;
  }

  async getShiftPatterns(tx: TenantTx): Promise<ShiftPatternRow[]> {
    return tx<ShiftPatternRow[]>`
      SELECT id, organization_id as "organizationId", name, cycle_days as "cycleDays",
             description, created_at as "createdAt", updated_at as "updatedAt"
      FROM shift_patterns
      ORDER BY created_at DESC
    `;
  }

  async getShiftPatternSteps(
    tx: TenantTx,
    patternId: string,
  ): Promise<ShiftPatternStepRow[]> {
    return tx<ShiftPatternStepRow[]>`
      SELECT s.id, s.organization_id as "organizationId", s.pattern_id as "patternId",
             s.step_order as "stepOrder", s.shift_template_id as "shiftTemplateId",
             s.is_rest as "isRest",
             t.code as "shiftCode", t.name as "shiftName"
      FROM shift_pattern_steps s
      LEFT JOIN shift_templates t ON t.id = s.shift_template_id
      WHERE s.pattern_id = ${patternId}
      ORDER BY s.step_order ASC
    `;
  }

  async createShiftPattern(
    tx: TenantTx,
    data: {
      name: string;
      cycleDays: number;
      description?: string | undefined;
      steps: Array<{
        stepOrder: number;
        shiftTemplateId?: string | null | undefined;
        isRest: boolean;
      }>;
    },
  ): Promise<ShiftPatternRow> {
    const patternRows = await tx<ShiftPatternRow[]>`
      INSERT INTO shift_patterns (name, cycle_days, description)
      VALUES (${data.name}, ${data.cycleDays}, ${data.description ?? null})
      RETURNING id, organization_id as "organizationId", name, cycle_days as "cycleDays",
                description, created_at as "createdAt", updated_at as "updatedAt"
    `;
    const pattern = patternRows[0]!;

    for (const step of data.steps) {
      await tx`
        INSERT INTO shift_pattern_steps (pattern_id, step_order, shift_template_id, is_rest)
        VALUES (${pattern.id}, ${step.stepOrder}, ${step.shiftTemplateId ?? null}, ${step.isRest})
      `;
    }

    return pattern;
  }

  async getShiftAssignments(
    tx: TenantTx,
    filter: {
      startDate: string;
      endDate: string;
      employeeId?: string | undefined;
    },
  ): Promise<ShiftAssignmentRow[]> {
    if (filter.employeeId) {
      return tx<ShiftAssignmentRow[]>`
        SELECT a.id, a.organization_id as "organizationId", a.employee_id as "employeeId",
               concat(e.first_name, ' ', e.last_name) as "employeeName",
               a.date::text as "date", a.shift_template_id as "shiftTemplateId",
               t.code as "shiftCode", t.name as "shiftName", t.type as "shiftType",
               t.start_time as "startTime", t.end_time as "endTime", t.color,
               a.status, a.notes,
               a.created_at as "createdAt", a.updated_at as "updatedAt"
        FROM shift_assignments a
        JOIN employees e ON e.id = a.employee_id
        LEFT JOIN shift_templates t ON t.id = a.shift_template_id
        WHERE a.employee_id = ${filter.employeeId}
          AND a.date >= ${filter.startDate}::date
          AND a.date <= ${filter.endDate}::date
        ORDER BY a.date ASC
      `;
    }

    return tx<ShiftAssignmentRow[]>`
      SELECT a.id, a.organization_id as "organizationId", a.employee_id as "employeeId",
             concat(e.first_name, ' ', e.last_name) as "employeeName",
             a.date::text as "date", a.shift_template_id as "shiftTemplateId",
             t.code as "shiftCode", t.name as "shiftName", t.type as "shiftType",
             t.start_time as "startTime", t.end_time as "endTime", t.color,
             a.status, a.notes,
             a.created_at as "createdAt", a.updated_at as "updatedAt"
      FROM shift_assignments a
      JOIN employees e ON e.id = a.employee_id
      LEFT JOIN shift_templates t ON t.id = a.shift_template_id
      WHERE a.date >= ${filter.startDate}::date
        AND a.date <= ${filter.endDate}::date
      ORDER BY a.date ASC, e.last_name ASC
    `;
  }

  async assignShifts(
    tx: TenantTx,
    assignments: Array<{
      employeeId: string;
      date: string;
      shiftTemplateId?: string | null | undefined;
      status?: string | undefined;
      notes?: string | undefined;
    }>,
  ): Promise<void> {
    for (const a of assignments) {
      // Remove any existing assignment on that date for that employee
      await tx`
        DELETE FROM shift_assignments
        WHERE employee_id = ${a.employeeId} AND date = ${a.date}::date
      `;

      // Insert new assignment
      await tx`
        INSERT INTO shift_assignments (employee_id, date, shift_template_id, status, notes)
        VALUES (
          ${a.employeeId},
          ${a.date}::date,
          ${a.shiftTemplateId ?? null},
          ${a.status ?? "scheduled"},
          ${a.notes ?? null}
        )
      `;
    }
  }

  async getShiftSwaps(
    tx: TenantTx,
    filter?:
      | { employeeId?: string | undefined; status?: string | undefined }
      | undefined,
  ): Promise<ShiftSwapRow[]> {
    return tx<ShiftSwapRow[]>`
      SELECT s.id, s.organization_id as "organizationId",
             s.requester_id as "requesterId", concat(er.first_name, ' ', er.last_name) as "requesterName",
             s.target_employee_id as "targetEmployeeId", concat(et.first_name, ' ', et.last_name) as "targetEmployeeName",
             s.requester_date::text as "requesterDate",
             s.target_date::text as "targetDate",
             s.status, s.reason, s.approver_id as "approverId", s.decided_at as "decidedAt",
             s.created_at as "createdAt", s.updated_at as "updatedAt"
      FROM shift_swaps s
      JOIN employees er ON er.id = s.requester_id
      JOIN employees et ON et.id = s.target_employee_id
      WHERE (${filter?.status ?? null}::text IS NULL OR s.status = ${filter?.status ?? null})
        AND (
          ${filter?.employeeId ?? null}::uuid IS NULL
          OR s.requester_id = ${filter?.employeeId ?? null}
          OR s.target_employee_id = ${filter?.employeeId ?? null}
        )
      ORDER BY s.created_at DESC
    `;
  }

  async createShiftSwap(
    tx: TenantTx,
    data: {
      requesterId: string;
      targetEmployeeId: string;
      requesterDate: string;
      targetDate: string;
      reason?: string | undefined;
    },
  ): Promise<ShiftSwapRow> {
    const rows = await tx<ShiftSwapRow[]>`
      INSERT INTO shift_swaps (
        requester_id, target_employee_id, requester_date, target_date, reason
      )
      VALUES (
        ${data.requesterId},
        ${data.targetEmployeeId},
        ${data.requesterDate}::date,
        ${data.targetDate}::date,
        ${data.reason ?? null}
      )
      RETURNING id, organization_id as "organizationId",
                requester_id as "requesterId",
                target_employee_id as "targetEmployeeId",
                requester_date::text as "requesterDate",
                target_date::text as "targetDate",
                status, reason, approver_id as "approverId", decided_at as "decidedAt",
                created_at as "createdAt", updated_at as "updatedAt"
    `;
    return rows[0]!;
  }

  async decideShiftSwap(
    tx: TenantTx,
    swapId: string,
    decision: {
      status: "approved" | "rejected";
      approverId: string;
    },
  ): Promise<ShiftSwapRow | null> {
    const existing = await tx<ShiftSwapRow[]>`
      SELECT id, organization_id as "organizationId",
             requester_id as "requesterId", target_employee_id as "targetEmployeeId",
             requester_date::text as "requesterDate", target_date::text as "targetDate",
             status, reason, approver_id as "approverId", decided_at as "decidedAt",
             created_at as "createdAt", updated_at as "updatedAt"
      FROM shift_swaps
      WHERE id = ${swapId}
      LIMIT 1
    `;

    if (!existing[0]) return null;
    const swap = existing[0];

    const updated = await tx<ShiftSwapRow[]>`
      UPDATE shift_swaps
      SET status = ${decision.status},
          approver_id = ${decision.approverId},
          decided_at = now(),
          updated_at = now()
      WHERE id = ${swapId}
      RETURNING id, organization_id as "organizationId",
                requester_id as "requesterId",
                target_employee_id as "targetEmployeeId",
                requester_date::text as "requesterDate",
                target_date::text as "targetDate",
                status, reason, approver_id as "approverId", decided_at as "decidedAt",
                created_at as "createdAt", updated_at as "updatedAt"
    `;

    // If approved, swap the assignments in shift_assignments table
    if (decision.status === "approved") {
      const requesterAssign = await tx<
        Array<{ shift_template_id: string | null }>
      >`
        SELECT shift_template_id FROM shift_assignments
        WHERE employee_id = ${swap.requesterId} AND date = ${swap.requesterDate}::date
        LIMIT 1
      `;
      const targetAssign = await tx<
        Array<{ shift_template_id: string | null }>
      >`
        SELECT shift_template_id FROM shift_assignments
        WHERE employee_id = ${swap.targetEmployeeId} AND date = ${swap.targetDate}::date
        LIMIT 1
      `;

      const reqShift = requesterAssign[0]?.shift_template_id ?? null;
      const targetShift = targetAssign[0]?.shift_template_id ?? null;

      // Swap them
      await tx`
        UPDATE shift_assignments
        SET shift_template_id = ${targetShift}, updated_at = now()
        WHERE employee_id = ${swap.requesterId} AND date = ${swap.requesterDate}::date
      `;
      await tx`
        UPDATE shift_assignments
        SET shift_template_id = ${reqShift}, updated_at = now()
        WHERE employee_id = ${swap.targetEmployeeId} AND date = ${swap.targetDate}::date
      `;
    }

    return updated[0] ?? null;
  }
}
