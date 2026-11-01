import type { TenantTx } from "../with-tenant.js";

export interface EmployeeRow {
  id: string;
  organizationId: string;
  userId: string | null;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  email: string;
  status: string;
}

export class EmployeeRepository {
  async findById(tx: TenantTx, id: string): Promise<EmployeeRow | null> {
    const rows = await tx<EmployeeRow[]>`
      SELECT id, organization_id as "organizationId", user_id as "userId",
             first_name as "firstName", last_name as "lastName",
             preferred_name as "preferredName", email, status
      FROM employees
      WHERE id = ${id}
      LIMIT 1
    `;
    return rows[0] ?? null;
  }

  async list(tx: TenantTx): Promise<EmployeeRow[]> {
    return tx<EmployeeRow[]>`
      SELECT id, organization_id as "organizationId", user_id as "userId",
             first_name as "firstName", last_name as "lastName",
             preferred_name as "preferredName", email, status
      FROM employees
      ORDER BY last_name, first_name
    `;
  }
}
