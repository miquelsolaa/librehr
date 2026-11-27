import type { TenantTx } from "../with-tenant.js";
import type { OrgGroupKind } from "./org-group.repository.js";

/**
 * ORG-007 (ADR 0008): secondary memberships of an employee in a department
 * or an org group (employee_memberships, 0046). The primary department is
 * not a membership row; it stays in employees.department_id.
 */
export interface EmployeeMembershipRow {
  id: string;
  organizationId: string;
  employeeId: string;
  departmentId: string | null;
  groupId: string | null;
  /** "department", or the group's kind. */
  targetType: "department" | OrgGroupKind;
  targetName: string;
  role: string | null;
  allocationPercent: number | null;
  /** Calendar dates (`YYYY-MM-DD`); endDate is included, null is open-ended. */
  startDate: string;
  endDate: string | null;
  createdBy: string;
  endedBy: string | null;
  endReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Exactly one of departmentId and groupId (CHECK in 0046). */
export type EmployeeMembershipTarget =
  | { departmentId: string; groupId?: undefined }
  | { groupId: string; departmentId?: undefined };

export type CreateEmployeeMembershipData = EmployeeMembershipTarget & {
  employeeId: string;
  role?: string | null | undefined;
  allocationPercent?: number | null | undefined;
  startDate: string;
  endDate?: string | null | undefined;
  /** User id of the actor. */
  createdBy: string;
};

/** Fields left undefined are kept; null clears an optional field. */
export interface UpdateEmployeeMembershipData {
  role?: string | null | undefined;
  allocationPercent?: number | null | undefined;
  startDate?: string | undefined;
  endDate?: string | null | undefined;
}

export interface EndEmployeeMembershipData {
  /** Last day of the membership (included). */
  endDate: string;
  /** User id of the actor. */
  endedBy: string;
  endReason?: string | null | undefined;
}

/**
 * Selects one membership row with its target's type and name. Joins check
 * the tenant explicitly, on top of RLS and the composite foreign keys.
 */
const selectRows = (tx: TenantTx) => tx`
  SELECT m.id, m.organization_id as "organizationId",
         m.employee_id as "employeeId", m.department_id as "departmentId",
         m.group_id as "groupId",
         coalesce(g.kind, 'department') as "targetType",
         coalesce(d.name, g.name) as "targetName",
         m.role, m.allocation_percent::float8 as "allocationPercent",
         m.start_date::text as "startDate", m.end_date::text as "endDate",
         m.created_by as "createdBy", m.ended_by as "endedBy",
         m.end_reason as "endReason",
         m.created_at as "createdAt", m.updated_at as "updatedAt"
  FROM employee_memberships m
  LEFT JOIN departments d
    ON d.id = m.department_id AND d.organization_id = m.organization_id
  LEFT JOIN org_groups g
    ON g.id = m.group_id AND g.organization_id = m.organization_id
`;

/** ORG-007: a membership as the org chart draws it (dotted line to a lead). */
export interface OrgChartMembershipRow {
  employeeId: string;
  type: "department" | OrgGroupKind;
  id: string;
  name: string;
  allocationPercent: number | null;
  leadEmployeeId: string | null;
  leadName: string | null;
}

export class EmployeeMembershipRepository {
  /** Every membership of an employee, current and past, newest first. */
  async listForEmployee(
    tx: TenantTx,
    employeeId: string,
  ): Promise<EmployeeMembershipRow[]> {
    return tx<EmployeeMembershipRow[]>`
      ${selectRows(tx)}
      WHERE m.organization_id = ${tx.__tenantContext.organizationId}
        AND m.employee_id = ${employeeId}
      ORDER BY m.start_date DESC, m.created_at DESC, m.id ASC
    `;
  }

  /**
   * Memberships of an employee active on a calendar date (the organization's
   * business date, from the caller).
   */
  async listActiveOn(
    tx: TenantTx,
    employeeId: string,
    date: string,
  ): Promise<EmployeeMembershipRow[]> {
    return tx<EmployeeMembershipRow[]>`
      ${selectRows(tx)}
      WHERE m.organization_id = ${tx.__tenantContext.organizationId}
        AND m.employee_id = ${employeeId}
        AND m.start_date <= ${date}::date
        AND (m.end_date IS NULL OR m.end_date >= ${date}::date)
      ORDER BY m.start_date ASC, m.id ASC
    `;
  }

  async findById(
    tx: TenantTx,
    employeeId: string,
    id: string,
  ): Promise<EmployeeMembershipRow | null> {
    const rows = await tx<EmployeeMembershipRow[]>`
      ${selectRows(tx)}
      WHERE m.organization_id = ${tx.__tenantContext.organizationId}
        AND m.employee_id = ${employeeId}
        AND m.id = ${id}
      LIMIT 1
    `;
    return rows[0] ?? null;
  }

  /**
   * Inserts a membership. Overlap with another row of the same employee and
   * target raises 23P01; a target of another tenant raises 23503.
   */
  async create(
    tx: TenantTx,
    data: CreateEmployeeMembershipData,
  ): Promise<EmployeeMembershipRow> {
    const inserted = await tx<{ id: string }[]>`
      INSERT INTO employee_memberships (
        employee_id, department_id, group_id, role, allocation_percent,
        start_date, end_date, created_by
      )
      VALUES (
        ${data.employeeId}, ${data.departmentId ?? null},
        ${data.groupId ?? null}, ${data.role ?? null},
        ${data.allocationPercent ?? null}, ${data.startDate},
        ${data.endDate ?? null}, ${data.createdBy}
      )
      RETURNING id
    `;
    const row = await this.findById(tx, data.employeeId, inserted[0]!.id);
    return row!;
  }

  async update(
    tx: TenantTx,
    employeeId: string,
    id: string,
    data: UpdateEmployeeMembershipData,
  ): Promise<EmployeeMembershipRow | null> {
    const updates: Record<string, unknown> = {};
    if (data.role !== undefined) updates["role"] = data.role;
    if (data.allocationPercent !== undefined)
      updates["allocation_percent"] = data.allocationPercent;
    if (data.startDate !== undefined) updates["start_date"] = data.startDate;
    if (data.endDate !== undefined) updates["end_date"] = data.endDate;
    if (Object.keys(updates).length > 0) {
      await tx`
        UPDATE employee_memberships
        SET ${tx(updates)}, updated_at = now()
        WHERE id = ${id} AND employee_id = ${employeeId}
          AND organization_id = ${tx.__tenantContext.organizationId}
      `;
    }
    return this.findById(tx, employeeId, id);
  }

  /**
   * Ends a membership on `endDate` (included) and records who ended it and
   * why; the row is kept as history. Null when the row does not exist in
   * this tenant. An end date before the start raises 23514.
   */
  async end(
    tx: TenantTx,
    employeeId: string,
    id: string,
    data: EndEmployeeMembershipData,
  ): Promise<EmployeeMembershipRow | null> {
    const result = await tx`
      UPDATE employee_memberships
      SET end_date = ${data.endDate}, ended_by = ${data.endedBy},
          end_reason = ${data.endReason ?? null}, updated_at = now()
      WHERE id = ${id} AND employee_id = ${employeeId}
        AND organization_id = ${tx.__tenantContext.organizationId}
    `;
    if (result.count === 0) return null;
    return this.findById(tx, employeeId, id);
  }

  /**
   * ORG-007 (ADR 0008 decision 8): employees a lead may see under the
   * organization's lead visibility setting, on a calendar date. A lead is the
   * lead_employee_id of a department or a non-archived group; members are the
   * department's primary members plus anyone with a membership in it active
   * on the date. The lead and terminated employees are left out.
   */
  async listMembersLedBy(
    tx: TenantTx,
    leadEmployeeId: string,
    date: string,
  ): Promise<string[]> {
    const orgId = tx.__tenantContext.organizationId;
    const rows = await tx<{ id: string }[]>`
      SELECT e.id
      FROM employees e
      WHERE e.organization_id = ${orgId}
        AND e.id <> ${leadEmployeeId}
        AND e.status <> 'terminated'
        AND (
          EXISTS (
            SELECT 1 FROM departments d
            WHERE d.organization_id = ${orgId}
              AND d.id = e.department_id
              AND d.lead_employee_id = ${leadEmployeeId}
          )
          OR EXISTS (
            SELECT 1
            FROM employee_memberships m
            LEFT JOIN departments d
              ON d.id = m.department_id AND d.organization_id = m.organization_id
            LEFT JOIN org_groups g
              ON g.id = m.group_id AND g.organization_id = m.organization_id
            WHERE m.organization_id = ${orgId}
              AND m.employee_id = e.id
              AND m.start_date <= ${date}::date
              AND (m.end_date IS NULL OR m.end_date >= ${date}::date)
              AND (
                d.lead_employee_id = ${leadEmployeeId}
                OR (g.lead_employee_id = ${leadEmployeeId}
                    AND g.archived_at IS NULL)
              )
          )
        )
      ORDER BY e.id
    `;
    return rows.map((r) => r.id);
  }

  /**
   * ORG-007 (ORG-004): every membership active on `date` (the organization's
   * business date), with the lead of its department or group, for the org
   * chart's dotted lines. Directory fields only.
   */
  async listActiveForOrgChart(
    tx: TenantTx,
    date: string,
  ): Promise<OrgChartMembershipRow[]> {
    const orgId = tx.__tenantContext.organizationId;
    return tx<OrgChartMembershipRow[]>`
      SELECT m.employee_id as "employeeId",
             coalesce(g.kind, 'department') as type,
             coalesce(m.department_id, m.group_id) as id,
             coalesce(d.name, g.name) as name,
             m.allocation_percent::float8 as "allocationPercent",
             l.id as "leadEmployeeId",
             CASE WHEN l.id IS NULL THEN NULL
                  ELSE CONCAT(l.first_name, ' ', l.last_name) END as "leadName"
      FROM employee_memberships m
      LEFT JOIN departments d
        ON d.id = m.department_id AND d.organization_id = m.organization_id
      LEFT JOIN org_groups g
        ON g.id = m.group_id AND g.organization_id = m.organization_id
      LEFT JOIN employees l
        ON l.id = coalesce(d.lead_employee_id, g.lead_employee_id)
       AND l.organization_id = m.organization_id
      WHERE m.organization_id = ${orgId}
        AND m.start_date <= ${date}::date
        AND (m.end_date IS NULL OR m.end_date >= ${date}::date)
      ORDER BY type, name, id
    `;
  }
}
