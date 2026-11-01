import type { TenantTx } from "../with-tenant.js";

export interface DepartmentRow {
  id: string;
  organizationId: string;
  name: string;
  parentId: string | null;
  leadEmployeeId: string | null;
  parentName?: string | null | undefined;
  leadName?: string | null | undefined;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateDepartmentData {
  name: string;
  parentId?: string | null | undefined;
  leadEmployeeId?: string | null | undefined;
}

export class DepartmentRepository {
  async findMany(tx: TenantTx): Promise<DepartmentRow[]> {
    return tx<DepartmentRow[]>`
      SELECT d.id, d.organization_id as "organizationId", d.name,
             d.parent_id as "parentId", d.lead_employee_id as "leadEmployeeId",
             d.created_at as "createdAt", d.updated_at as "updatedAt",
             p.name as "parentName",
             CONCAT(e.first_name, ' ', e.last_name) as "leadName"
      FROM departments d
      LEFT JOIN departments p ON p.id = d.parent_id
      LEFT JOIN employees e ON e.id = d.lead_employee_id
      ORDER BY d.name ASC
    `;
  }

  async findById(tx: TenantTx, id: string): Promise<DepartmentRow | null> {
    const rows = await tx<DepartmentRow[]>`
      SELECT d.id, d.organization_id as "organizationId", d.name,
             d.parent_id as "parentId", d.lead_employee_id as "leadEmployeeId",
             d.created_at as "createdAt", d.updated_at as "updatedAt",
             p.name as "parentName",
             CONCAT(e.first_name, ' ', e.last_name) as "leadName"
      FROM departments d
      LEFT JOIN departments p ON p.id = d.parent_id
      LEFT JOIN employees e ON e.id = d.lead_employee_id
      WHERE d.id = ${id}
      LIMIT 1
    `;
    return rows[0] ?? null;
  }

  async create(
    tx: TenantTx,
    data: CreateDepartmentData,
  ): Promise<DepartmentRow> {
    const rows = await tx<DepartmentRow[]>`
      INSERT INTO departments (name, parent_id, lead_employee_id)
      VALUES (${data.name}, ${data.parentId ?? null}, ${data.leadEmployeeId ?? null})
      RETURNING id, organization_id as "organizationId", name,
                parent_id as "parentId", lead_employee_id as "leadEmployeeId",
                created_at as "createdAt", updated_at as "updatedAt"
    `;
    return rows[0]!;
  }

  async delete(tx: TenantTx, id: string): Promise<boolean> {
    const result = await tx`
      DELETE FROM departments
      WHERE id = ${id}
    `;
    return result.count > 0;
  }
}
