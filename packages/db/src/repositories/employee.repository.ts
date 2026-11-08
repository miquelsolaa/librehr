import type { TenantTx } from "../with-tenant.js";
import { encryptEnvelope, decryptEnvelope } from "../crypto/envelope.js";

export interface EmployeeRow {
  id: string;
  organizationId: string;
  userId: string | null;
  departmentId: string | null;
  managerId: string | null;
  locationId: string | null;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  email: string;
  phone: string | null;
  address: string | null;
  birthDate: string | null;
  status: string;
  terminationDate: string | null;
  terminationReason: string | null;
  nationalIdEncrypted: string | null;
  ibanEncrypted: string | null;
  pinHash: string | null;
  pinSalt: string | null;
  badgeId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface EmployeeListItem {
  id: string;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  email: string;
  status: string;
  departmentName: string | null;
  locationName: string | null;
  jobTitle: string | null;
  managerName: string | null;
}

export interface EmployeeProfile extends EmployeeRow {
  departmentName: string | null;
  locationName: string | null;
  managerName: string | null;
  jobTitle: string | null;
  employmentType: string | null;
  startDate: string | null;
  hasNationalId: boolean;
  hasIban: boolean;
}

export interface ListEmployeesFilters {
  search?: string | undefined;
  departmentId?: string | undefined;
  locationId?: string | undefined;
  status?: string | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
}

export interface CreateEmployeeData {
  userId?: string | null | undefined;
  departmentId?: string | null | undefined;
  managerId?: string | null | undefined;
  locationId?: string | null | undefined;
  firstName: string;
  lastName: string;
  preferredName?: string | null | undefined;
  email: string;
  phone?: string | null | undefined;
  address?: string | null | undefined;
  birthDate?: string | null | undefined;
  status?: string | undefined;
  nationalId?: string | null | undefined;
  iban?: string | null | undefined;
  jobTitle?: string | undefined;
  employmentType?: string | undefined;
  startDate?: string | undefined;
}

export interface UpdateEmployeeData {
  departmentId?: string | null | undefined;
  managerId?: string | null | undefined;
  locationId?: string | null | undefined;
  firstName?: string | undefined;
  lastName?: string | undefined;
  preferredName?: string | null | undefined;
  email?: string | undefined;
  phone?: string | null | undefined;
  address?: string | null | undefined;
  birthDate?: string | null | undefined;
  status?: string | undefined;
  nationalId?: string | null | undefined;
  iban?: string | null | undefined;
}

export class EmployeeRepository {
  async findByUserId(
    tx: TenantTx,
    userId: string,
  ): Promise<EmployeeProfile | null> {
    const rows = await tx<{ id: string }[]>`
      SELECT id FROM employees WHERE user_id = ${userId} AND organization_id = ${tx.__tenantContext.organizationId} LIMIT 1
    `;
    if (!rows[0]) return null;
    return this.findById(tx, rows[0].id);
  }

  async findById(tx: TenantTx, id: string): Promise<EmployeeProfile | null> {
    const rows = await tx<
      (EmployeeRow & {
        departmentName: string | null;
        locationName: string | null;
        managerName: string | null;
        jobTitle: string | null;
        employmentType: string | null;
        startDate: string | null;
      })[]
    >`
      SELECT e.id, e.organization_id as "organizationId", e.user_id as "userId",
             e.department_id as "departmentId", e.manager_id as "managerId", e.location_id as "locationId",
             e.first_name as "firstName", e.last_name as "lastName",
             e.preferred_name as "preferredName", e.email, e.phone, e.address,
             e.birth_date::text as "birthDate", e.status,
             e.termination_date::text as "terminationDate", e.termination_reason as "terminationReason",
             e.national_id_encrypted as "nationalIdEncrypted", e.iban_encrypted as "ibanEncrypted",
             e.created_at as "createdAt", e.updated_at as "updatedAt",
             d.name as "departmentName",
             loc.name as "locationName",
             CONCAT(m.first_name, ' ', m.last_name) as "managerName",
             emp.job_title as "jobTitle",
             emp.employment_type as "employmentType",
             emp.start_date::text as "startDate"
      FROM employees e
      LEFT JOIN departments d ON d.id = e.department_id AND d.organization_id = ${tx.__tenantContext.organizationId}
      LEFT JOIN locations loc ON loc.id = e.location_id AND loc.organization_id = ${tx.__tenantContext.organizationId}
      LEFT JOIN employees m ON m.id = e.manager_id AND m.organization_id = ${tx.__tenantContext.organizationId}
      LEFT JOIN LATERAL (
        SELECT job_title, employment_type, start_date
        FROM employments
        WHERE employee_id = e.id AND organization_id = ${tx.__tenantContext.organizationId}
        ORDER BY start_date DESC
        LIMIT 1
      ) emp ON true
      WHERE e.id = ${id} AND e.organization_id = ${tx.__tenantContext.organizationId}
      LIMIT 1
    `;

    const row = rows[0];
    if (!row) return null;

    return {
      ...row,
      hasNationalId: !!row.nationalIdEncrypted,
      hasIban: !!row.ibanEncrypted,
    };
  }

  async list(
    tx: TenantTx,
    filters: ListEmployeesFilters = {},
  ): Promise<{ items: EmployeeListItem[]; total: number }> {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 20));
    const offset = (page - 1) * pageSize;

    const searchPattern = filters.search
      ? `%${filters.search.trim().toLowerCase()}%`
      : null;

    const rows = await tx<EmployeeListItem[]>`
      SELECT e.id, e.first_name as "firstName", e.last_name as "lastName",
             e.preferred_name as "preferredName", e.email, e.status,
             d.name as "departmentName",
             loc.name as "locationName",
             emp.job_title as "jobTitle",
             CONCAT(m.first_name, ' ', m.last_name) as "managerName"
      FROM employees e
      LEFT JOIN departments d ON d.id = e.department_id AND d.organization_id = ${tx.__tenantContext.organizationId}
      LEFT JOIN locations loc ON loc.id = e.location_id AND loc.organization_id = ${tx.__tenantContext.organizationId}
      LEFT JOIN employees m ON m.id = e.manager_id AND m.organization_id = ${tx.__tenantContext.organizationId}
      LEFT JOIN LATERAL (
        SELECT job_title
        FROM employments
        WHERE employee_id = e.id AND organization_id = ${tx.__tenantContext.organizationId}
        ORDER BY start_date DESC
        LIMIT 1
      ) emp ON true
      WHERE e.organization_id = ${tx.__tenantContext.organizationId}
        AND (${searchPattern}::text IS NULL OR
             LOWER(e.first_name) LIKE ${searchPattern} OR
             LOWER(e.last_name) LIKE ${searchPattern} OR
             LOWER(e.email) LIKE ${searchPattern})
        AND (${filters.departmentId ?? null}::uuid IS NULL OR e.department_id = ${filters.departmentId ?? null})
        AND (${filters.locationId ?? null}::uuid IS NULL OR e.location_id = ${filters.locationId ?? null})
        AND (${filters.status ?? null}::text IS NULL OR e.status = ${filters.status ?? null})
      ORDER BY e.last_name, e.first_name
      LIMIT ${pageSize} OFFSET ${offset}
    `;

    const countResult = await tx<[{ count: string }]>`
      SELECT COUNT(*)::text as count
      FROM employees e
      WHERE e.organization_id = ${tx.__tenantContext.organizationId}
        AND (${searchPattern}::text IS NULL OR
             LOWER(e.first_name) LIKE ${searchPattern} OR
             LOWER(e.last_name) LIKE ${searchPattern} OR
             LOWER(e.email) LIKE ${searchPattern})
        AND (${filters.departmentId ?? null}::uuid IS NULL OR e.department_id = ${filters.departmentId ?? null})
        AND (${filters.locationId ?? null}::uuid IS NULL OR e.location_id = ${filters.locationId ?? null})
        AND (${filters.status ?? null}::text IS NULL OR e.status = ${filters.status ?? null})
    `;

    const total = parseInt(countResult[0]?.count ?? "0", 10);
    return { items: rows, total };
  }

  async create(
    tx: TenantTx,
    data: CreateEmployeeData,
  ): Promise<EmployeeProfile> {
    const nationalIdEncrypted = data.nationalId
      ? encryptEnvelope(data.nationalId)
      : null;
    const ibanEncrypted = data.iban ? encryptEnvelope(data.iban) : null;

    const inserted = await tx<EmployeeRow[]>`
      INSERT INTO employees (
        user_id, department_id, manager_id, location_id,
        first_name, last_name, preferred_name, email,
        phone, address, birth_date, status,
        national_id_encrypted, iban_encrypted
      ) VALUES (
        ${data.userId ?? null},
        ${data.departmentId ?? null},
        ${data.managerId ?? null},
        ${data.locationId ?? null},
        ${data.firstName},
        ${data.lastName},
        ${data.preferredName ?? null},
        ${data.email},
        ${data.phone ?? null},
        ${data.address ?? null},
        ${data.birthDate ?? null},
        ${data.status ?? "active"},
        ${nationalIdEncrypted},
        ${ibanEncrypted}
      )
      RETURNING id, organization_id as "organizationId", user_id as "userId",
                department_id as "departmentId", manager_id as "managerId", location_id as "locationId",
                first_name as "firstName", last_name as "lastName",
                preferred_name as "preferredName", email, phone, address,
                birth_date::text as "birthDate", status,
                termination_date::text as "terminationDate", termination_reason as "terminationReason",
                national_id_encrypted as "nationalIdEncrypted", iban_encrypted as "ibanEncrypted",
                created_at as "createdAt", updated_at as "updatedAt"
    `;

    const emp = inserted[0]!;

    if (data.jobTitle) {
      const startDate = data.startDate ?? new Date().toISOString().slice(0, 10);
      const employmentType = data.employmentType ?? "indefinido";
      await tx`
        INSERT INTO employments (
          employee_id, job_title, employment_type, start_date
        ) VALUES (
          ${emp.id},
          ${data.jobTitle},
          ${employmentType},
          ${startDate}
        )
      `;
    }

    const full = await this.findById(tx, emp.id);
    return full!;
  }

  async update(
    tx: TenantTx,
    id: string,
    data: UpdateEmployeeData,
  ): Promise<EmployeeProfile> {
    const updates: Record<string, unknown> = {};

    if (data.firstName !== undefined) updates["first_name"] = data.firstName;
    if (data.lastName !== undefined) updates["last_name"] = data.lastName;
    if (data.preferredName !== undefined)
      updates["preferred_name"] = data.preferredName;
    if (data.email !== undefined) updates["email"] = data.email;
    if (data.phone !== undefined) updates["phone"] = data.phone;
    if (data.address !== undefined) updates["address"] = data.address;
    if (data.birthDate !== undefined) updates["birth_date"] = data.birthDate;
    if (data.departmentId !== undefined)
      updates["department_id"] = data.departmentId;
    if (data.managerId !== undefined) updates["manager_id"] = data.managerId;
    if (data.locationId !== undefined) updates["location_id"] = data.locationId;
    if (data.status !== undefined) updates["status"] = data.status;
    if (data.nationalId !== undefined) {
      updates["national_id_encrypted"] = data.nationalId
        ? encryptEnvelope(data.nationalId)
        : null;
    }
    if (data.iban !== undefined) {
      updates["iban_encrypted"] = data.iban ? encryptEnvelope(data.iban) : null;
    }

    if (Object.keys(updates).length > 0) {
      await tx`
        UPDATE employees
        SET ${tx(updates)}, updated_at = now()
        WHERE id = ${id}
      `;
    }

    const full = await this.findById(tx, id);
    return full!;
  }

  async terminate(
    tx: TenantTx,
    id: string,
    data: { terminationDate: string; terminationReason: string },
  ): Promise<EmployeeProfile> {
    await tx`
      UPDATE employees
      SET status = 'terminated',
          termination_date = ${data.terminationDate},
          termination_reason = ${data.terminationReason},
          updated_at = now()
      WHERE id = ${id}
    `;

    const full = await this.findById(tx, id);
    return full!;
  }

  async revealSensitiveField(
    tx: TenantTx,
    id: string,
    field: "nationalId" | "iban",
  ): Promise<string | null> {
    const rows =
      field === "nationalId"
        ? await tx<{ val: string | null }[]>`
            SELECT national_id_encrypted as val
            FROM employees
            WHERE id = ${id}
            LIMIT 1
          `
        : await tx<{ val: string | null }[]>`
            SELECT iban_encrypted as val
            FROM employees
            WHERE id = ${id}
            LIMIT 1
          `;

    const encrypted = rows[0]?.val;
    if (!encrypted) return null;
    return decryptEnvelope(encrypted);
  }

  async findOrgChartItems(tx: TenantTx): Promise<
    {
      id: string;
      name: string;
      preferredName: string | null;
      email: string;
      jobTitle: string | null;
      departmentId: string | null;
      departmentName: string | null;
      locationName: string | null;
      managerId: string | null;
    }[]
  > {
    return tx<
      {
        id: string;
        name: string;
        preferredName: string | null;
        email: string;
        jobTitle: string | null;
        departmentId: string | null;
        departmentName: string | null;
        locationName: string | null;
        managerId: string | null;
      }[]
    >`
      SELECT e.id,
             CONCAT(e.first_name, ' ', e.last_name) as name,
             e.preferred_name as "preferredName",
             e.email,
             emp.job_title as "jobTitle",
             e.department_id as "departmentId",
             d.name as "departmentName",
             loc.name as "locationName",
             e.manager_id as "managerId"
      FROM employees e
      LEFT JOIN departments d ON d.id = e.department_id
      LEFT JOIN locations loc ON loc.id = e.location_id
      LEFT JOIN employments emp ON emp.employee_id = e.id AND emp.end_date IS NULL
      WHERE e.status != 'terminated'
      ORDER BY e.first_name ASC
    `;
  }

  async updateSelfService(
    tx: TenantTx,
    id: string,
    data: {
      preferredName?: string | null | undefined;
      phone?: string | null | undefined;
      address?: string | null | undefined;
    },
  ): Promise<EmployeeProfile | null> {
    const current = await this.findById(tx, id);
    if (!current) return null;

    await tx`
      UPDATE employees
      SET preferred_name = ${data.preferredName !== undefined ? data.preferredName : current.preferredName},
          phone = ${data.phone !== undefined ? data.phone : current.phone},
          address = ${data.address !== undefined ? data.address : current.address},
          updated_at = now()
      WHERE id = ${id}
    `;

    return this.findById(tx, id);
  }

  // TIM-010: Tablet kiosk authentication & identification
  async setKioskPin(
    tx: TenantTx,
    employeeId: string,
    pinHash: string,
    pinSalt: string,
    badgeId?: string | null | undefined,
  ): Promise<void> {
    await tx`
      UPDATE employees
      SET pin_hash = ${pinHash},
          pin_salt = ${pinSalt},
          badge_id = ${badgeId !== undefined ? badgeId : null},
          updated_at = now()
      WHERE id = ${employeeId}
    `;
  }

  async findByIdentifier(
    tx: TenantTx,
    identifier: string,
  ): Promise<EmployeeRow | null> {
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        identifier,
      );

    const rows = await tx<EmployeeRow[]>`
      SELECT id, organization_id as "organizationId", user_id as "userId",
             department_id as "departmentId", manager_id as "managerId",
             location_id as "locationId", first_name as "firstName",
             last_name as "lastName", preferred_name as "preferredName",
             email, phone, address, birth_date as "birthDate",
             status, termination_date as "terminationDate",
             termination_reason as "terminationReason",
             national_id_encrypted as "nationalIdEncrypted",
             iban_encrypted as "ibanEncrypted",
             pin_hash as "pinHash", pin_salt as "pinSalt", badge_id as "badgeId",
             created_at as "createdAt", updated_at as "updatedAt"
      FROM employees
      WHERE status != 'terminated'
        AND (
          LOWER(email) = LOWER(${identifier})
          OR badge_id = ${identifier}
          OR (${isUuid ? identifier : null}::uuid IS NOT NULL AND id = ${isUuid ? identifier : null}::uuid)
        )
      LIMIT 1
    `;
    return rows[0] ?? null;
  }
}
