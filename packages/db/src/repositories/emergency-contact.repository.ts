import type { TenantTx } from "../with-tenant.js";

export interface EmergencyContactRow {
  id: string;
  organizationId: string;
  employeeId: string;
  fullName: string;
  relationship: string;
  phonePrimary: string;
  phoneSecondary: string | null;
  isPrimary: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateEmergencyContactData {
  employeeId: string;
  fullName: string;
  relationship: string;
  phonePrimary: string;
  phoneSecondary?: string | null | undefined;
  isPrimary?: boolean | undefined;
}

export interface UpdateEmergencyContactData {
  fullName?: string | undefined;
  relationship?: string | undefined;
  phonePrimary?: string | undefined;
  phoneSecondary?: string | null | undefined;
  isPrimary?: boolean | undefined;
}

export class EmergencyContactRepository {
  async findByEmployeeId(
    tx: TenantTx,
    employeeId: string,
  ): Promise<EmergencyContactRow[]> {
    return tx<EmergencyContactRow[]>`
      SELECT id, organization_id as "organizationId", employee_id as "employeeId",
             full_name as "fullName", relationship,
             phone_primary as "phonePrimary", phone_secondary as "phoneSecondary",
             is_primary as "isPrimary", created_at as "createdAt", updated_at as "updatedAt"
      FROM emergency_contacts
      WHERE employee_id = ${employeeId}
      ORDER BY is_primary DESC, created_at ASC
    `;
  }

  async findById(
    tx: TenantTx,
    id: string,
  ): Promise<EmergencyContactRow | null> {
    const rows = await tx<EmergencyContactRow[]>`
      SELECT id, organization_id as "organizationId", employee_id as "employeeId",
             full_name as "fullName", relationship,
             phone_primary as "phonePrimary", phone_secondary as "phoneSecondary",
             is_primary as "isPrimary", created_at as "createdAt", updated_at as "updatedAt"
      FROM emergency_contacts
      WHERE id = ${id}
      LIMIT 1
    `;
    return rows[0] ?? null;
  }

  async create(
    tx: TenantTx,
    data: CreateEmergencyContactData,
  ): Promise<EmergencyContactRow> {
    const rows = await tx<EmergencyContactRow[]>`
      INSERT INTO emergency_contacts (
        employee_id, full_name, relationship, phone_primary, phone_secondary, is_primary
      )
      VALUES (
        ${data.employeeId}, ${data.fullName}, ${data.relationship},
        ${data.phonePrimary}, ${data.phoneSecondary ?? null}, ${data.isPrimary ?? false}
      )
      RETURNING id, organization_id as "organizationId", employee_id as "employeeId",
                full_name as "fullName", relationship,
                phone_primary as "phonePrimary", phone_secondary as "phoneSecondary",
                is_primary as "isPrimary", created_at as "createdAt", updated_at as "updatedAt"
    `;
    return rows[0]!;
  }

  async update(
    tx: TenantTx,
    id: string,
    data: UpdateEmergencyContactData,
  ): Promise<EmergencyContactRow | null> {
    const current = await this.findById(tx, id);
    if (!current) return null;

    const rows = await tx<EmergencyContactRow[]>`
      UPDATE emergency_contacts
      SET full_name = ${data.fullName ?? current.fullName},
          relationship = ${data.relationship ?? current.relationship},
          phone_primary = ${data.phonePrimary ?? current.phonePrimary},
          phone_secondary = ${data.phoneSecondary !== undefined ? data.phoneSecondary : current.phoneSecondary},
          is_primary = ${data.isPrimary !== undefined ? data.isPrimary : current.isPrimary},
          updated_at = now()
      WHERE id = ${id}
      RETURNING id, organization_id as "organizationId", employee_id as "employeeId",
                full_name as "fullName", relationship,
                phone_primary as "phonePrimary", phone_secondary as "phoneSecondary",
                is_primary as "isPrimary", created_at as "createdAt", updated_at as "updatedAt"
    `;
    return rows[0] ?? null;
  }

  async delete(tx: TenantTx, id: string): Promise<boolean> {
    const result = await tx`
      DELETE FROM emergency_contacts
      WHERE id = ${id}
    `;
    return (result.count ?? 0) > 0;
  }
}
