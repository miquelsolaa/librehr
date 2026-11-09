import type { TenantTx } from "../with-tenant.js";

export interface CustomFieldDefinitionRow {
  id: string;
  organizationId: string;
  name: string;
  code: string;
  fieldType: "text" | "number" | "date" | "select";
  options: string[] | null;
  required: boolean;
  visibility: "admin" | "hr" | "manager" | "employee" | "public";
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateCustomFieldDefinitionData {
  name: string;
  code: string;
  fieldType: "text" | "number" | "date" | "select";
  options?: string[] | null | undefined;
  required?: boolean | undefined;
  visibility?: "admin" | "hr" | "manager" | "employee" | "public" | undefined;
}

export interface CustomFieldValueRow {
  id: string;
  organizationId: string;
  fieldDefinitionId: string;
  employeeId: string;
  value: string | null;
  fieldName?: string | undefined;
  fieldCode?: string | undefined;
  fieldType?: string | undefined;
  options?: string[] | null | undefined;
  visibility?: string | undefined;
  createdAt: Date;
  updatedAt: Date;
}

export class CustomFieldRepository {
  async findDefinitions(tx: TenantTx): Promise<CustomFieldDefinitionRow[]> {
    const rows = await tx<
      {
        id: string;
        organizationId: string;
        name: string;
        code: string;
        fieldType: string;
        options: string | null;
        required: boolean;
        visibility: string;
        createdAt: Date;
        updatedAt: Date;
      }[]
    >`
      SELECT id, organization_id as "organizationId", name, code,
             field_type as "fieldType", options, required, visibility,
             created_at as "createdAt", updated_at as "updatedAt"
      FROM custom_field_definitions
      ORDER BY name ASC
    `;

    return rows.map((r) => ({
      ...r,
      fieldType: r.fieldType as CustomFieldDefinitionRow["fieldType"],
      visibility: r.visibility as CustomFieldDefinitionRow["visibility"],
      options: r.options ? JSON.parse(r.options) : null,
    }));
  }

  async findDefinitionById(
    tx: TenantTx,
    id: string,
  ): Promise<CustomFieldDefinitionRow | null> {
    const rows = await tx<
      {
        id: string;
        organizationId: string;
        name: string;
        code: string;
        fieldType: string;
        options: string | null;
        required: boolean;
        visibility: string;
        createdAt: Date;
        updatedAt: Date;
      }[]
    >`
      SELECT id, organization_id as "organizationId", name, code,
             field_type as "fieldType", options, required, visibility,
             created_at as "createdAt", updated_at as "updatedAt"
      FROM custom_field_definitions
      WHERE id = ${id} AND organization_id = ${tx.__tenantContext.organizationId}
      LIMIT 1
    `;

    const r = rows[0];
    if (!r) return null;

    return {
      ...r,
      fieldType: r.fieldType as CustomFieldDefinitionRow["fieldType"],
      visibility: r.visibility as CustomFieldDefinitionRow["visibility"],
      options: r.options ? JSON.parse(r.options) : null,
    };
  }

  async createDefinition(
    tx: TenantTx,
    data: CreateCustomFieldDefinitionData,
  ): Promise<CustomFieldDefinitionRow> {
    const optionsJson = data.options ? JSON.stringify(data.options) : null;
    const rows = await tx<
      {
        id: string;
        organizationId: string;
        name: string;
        code: string;
        fieldType: string;
        options: string | null;
        required: boolean;
        visibility: string;
        createdAt: Date;
        updatedAt: Date;
      }[]
    >`
      INSERT INTO custom_field_definitions (name, code, field_type, options, required, visibility)
      VALUES (${data.name}, ${data.code}, ${data.fieldType}, ${optionsJson}, ${data.required ?? false}, ${data.visibility ?? "employee"})
      RETURNING id, organization_id as "organizationId", name, code,
                field_type as "fieldType", options, required, visibility,
                created_at as "createdAt", updated_at as "updatedAt"
    `;

    const r = rows[0]!;
    return {
      ...r,
      fieldType: r.fieldType as CustomFieldDefinitionRow["fieldType"],
      visibility: r.visibility as CustomFieldDefinitionRow["visibility"],
      options: r.options ? JSON.parse(r.options) : null,
    };
  }

  async deleteDefinition(tx: TenantTx, id: string): Promise<boolean> {
    const result = await tx`
      DELETE FROM custom_field_definitions
      WHERE id = ${id}
    `;
    return (result.count ?? 0) > 0;
  }

  async findValuesByEmployee(
    tx: TenantTx,
    employeeId: string,
  ): Promise<CustomFieldValueRow[]> {
    const rows = await tx<
      {
        id: string;
        organizationId: string;
        fieldDefinitionId: string;
        employeeId: string;
        value: string | null;
        fieldName: string;
        fieldCode: string;
        fieldType: string;
        options: string | null;
        visibility: string;
        createdAt: Date;
        updatedAt: Date;
      }[]
    >`
      SELECT v.id, v.organization_id as "organizationId",
             v.field_definition_id as "fieldDefinitionId",
             v.employee_id as "employeeId", v.value,
             d.name as "fieldName", d.code as "fieldCode",
             d.field_type as "fieldType", d.options, d.visibility,
             v.created_at as "createdAt", v.updated_at as "updatedAt"
      FROM custom_field_values v
      INNER JOIN custom_field_definitions d ON d.id = v.field_definition_id
      WHERE v.employee_id = ${employeeId}
        AND v.organization_id = ${tx.__tenantContext.organizationId}
      ORDER BY d.name ASC
    `;

    return rows.map((r) => ({
      ...r,
      options: r.options ? JSON.parse(r.options) : null,
    }));
  }

  async upsertValue(
    tx: TenantTx,
    fieldDefinitionId: string,
    employeeId: string,
    value: string | null,
  ): Promise<CustomFieldValueRow> {
    // Check if exists
    const existing = await tx<{ id: string }[]>`
      SELECT id FROM custom_field_values
      WHERE field_definition_id = ${fieldDefinitionId} AND employee_id = ${employeeId}
      LIMIT 1
    `;

    if (existing.length > 0 && existing[0]) {
      const rows = await tx<
        {
          id: string;
          organizationId: string;
          fieldDefinitionId: string;
          employeeId: string;
          value: string | null;
          createdAt: Date;
          updatedAt: Date;
        }[]
      >`
        UPDATE custom_field_values
        SET value = ${value}, updated_at = now()
        WHERE id = ${existing[0].id}
        RETURNING id, organization_id as "organizationId",
                  field_definition_id as "fieldDefinitionId",
                  employee_id as "employeeId", value,
                  created_at as "createdAt", updated_at as "updatedAt"
      `;
      return rows[0]!;
    } else {
      const rows = await tx<
        {
          id: string;
          organizationId: string;
          fieldDefinitionId: string;
          employeeId: string;
          value: string | null;
          createdAt: Date;
          updatedAt: Date;
        }[]
      >`
        INSERT INTO custom_field_values (field_definition_id, employee_id, value)
        VALUES (${fieldDefinitionId}, ${employeeId}, ${value})
        RETURNING id, organization_id as "organizationId",
                  field_definition_id as "fieldDefinitionId",
                  employee_id as "employeeId", value,
                  created_at as "createdAt", updated_at as "updatedAt"
      `;
      return rows[0]!;
    }
  }
}
