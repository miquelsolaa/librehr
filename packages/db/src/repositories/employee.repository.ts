import type { TenantTx } from "../with-tenant.js";
import { encryptEnvelope, decryptEnvelope } from "../crypto/envelope.js";
import {
  EFFECTIVE_EMPLOYMENT_END,
  loadEmploymentPeriods,
  type EmploymentSpan,
} from "./employment-periods.js";

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
  /** ORG-007: secondary memberships active on `asOf`; empty without it. */
  secondaryMemberships: DirectoryMembershipRow[];
}

/** ORG-007: a secondary membership as the directory shows it. */
export interface DirectoryMembershipRow {
  type: "department" | "project" | "area";
  /** The department or group id. */
  id: string;
  name: string;
  allocationPercent: number | null;
}

export interface EmployeeProfile extends EmployeeRow {
  departmentName: string | null;
  locationName: string | null;
  managerName: string | null;
  jobTitle: string | null;
  employmentType: string | null;
  workingHoursPerWeek: number | null;
  startDate: string | null;
  hasNationalId: boolean;
  hasIban: boolean;
}

export interface ListEmployeesFilters {
  search?: string | undefined;
  departmentId?: string | undefined;
  /** ORG-007: members of this project or area on `asOf`. */
  groupId?: string | undefined;
  /**
   * ORG-007: "any" also matches departmentId against secondary memberships
   * active on `asOf`. Default "primary" (the primary department only).
   */
  membership?: "primary" | "any" | undefined;
  /**
   * The business date (organization time zone) memberships are read on.
   * Without it, groupId and "any" match no membership.
   */
  asOf?: string | undefined;
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
  workingHoursPerWeek?: number | undefined;
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

/** Scope fields and display name of an employee listed for an export. */
export interface EmployedDuringRow {
  id: string;
  organizationId: string;
  userId: string | null;
  departmentId: string | null;
  managerId: string | null;
  locationId: string | null;
  firstName: string;
  lastName: string;
}

export interface EmployeePolicyIdentity {
  employeeId: string;
  departmentId: string | null;
  locationId: string | null;
  /** Employee ids of direct reports. */
  reports: string[];
}

export class EmployeeRepository {
  /**
   * Resolves the employee linked to a user in the current organization and
   * their direct reports, for authorization scope checks.
   */
  async findPolicyIdentity(
    tx: TenantTx,
    userId: string,
  ): Promise<EmployeePolicyIdentity | null> {
    const orgId = tx.__tenantContext.organizationId;
    const rows = await tx<
      {
        employeeId: string;
        departmentId: string | null;
        locationId: string | null;
        reports: string[] | null;
      }[]
    >`
      SELECT e.id as "employeeId", e.department_id as "departmentId",
             e.location_id as "locationId",
             ARRAY(
               SELECT r.id::text FROM employees r
               WHERE r.manager_id = e.id AND r.organization_id = ${orgId}
             ) as "reports"
      FROM employees e
      WHERE e.user_id = ${userId} AND e.organization_id = ${orgId}
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) return null;
    return { ...row, reports: row.reports ?? [] };
  }

  /**
   * Scope fields of several employees in one query, for authorization checks
   * over a list (no personal data is read).
   */
  async findScopeByIds(
    tx: TenantTx,
    ids: readonly string[],
  ): Promise<
    {
      id: string;
      organizationId: string;
      userId: string | null;
      managerId: string | null;
      departmentId: string | null;
      locationId: string | null;
    }[]
  > {
    if (ids.length === 0) return [];
    return tx`
      SELECT id, organization_id as "organizationId", user_id as "userId",
             manager_id as "managerId", department_id as "departmentId",
             location_id as "locationId"
      FROM employees
      WHERE organization_id = ${tx.__tenantContext.organizationId}
        AND id = ANY(${[...ids]}::uuid[])
    `;
  }

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
        workingHoursPerWeek: number | null;
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
             emp.working_hours_per_week::float as "workingHoursPerWeek",
             emp.start_date::text as "startDate"
      FROM employees e
      LEFT JOIN departments d ON d.id = e.department_id AND d.organization_id = ${tx.__tenantContext.organizationId}
      LEFT JOIN locations loc ON loc.id = e.location_id AND loc.organization_id = ${tx.__tenantContext.organizationId}
      LEFT JOIN employees m ON m.id = e.manager_id AND m.organization_id = ${tx.__tenantContext.organizationId}
      LEFT JOIN LATERAL (
        SELECT job_title, employment_type, working_hours_per_week, start_date
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
    const orgId = tx.__tenantContext.organizationId;
    const asOf = filters.asOf ?? null;
    const departmentId = filters.departmentId ?? null;
    const groupId = filters.groupId ?? null;
    const anyMembership = filters.membership === "any";
    // A fresh fragment per query: the list and the count use the same filter.
    const membershipFilter = () => tx`
      AND (${departmentId}::uuid IS NULL OR e.department_id = ${departmentId}
        OR (${anyMembership}::boolean AND EXISTS (
          SELECT 1 FROM employee_memberships em
          WHERE em.organization_id = ${orgId} AND em.employee_id = e.id
            AND em.department_id = ${departmentId}
            AND em.start_date <= ${asOf}::date
            AND (em.end_date IS NULL OR em.end_date >= ${asOf}::date)
        )))
      AND (${groupId}::uuid IS NULL OR EXISTS (
        SELECT 1 FROM employee_memberships em
        WHERE em.organization_id = ${orgId} AND em.employee_id = e.id
          AND em.group_id = ${groupId}
          AND em.start_date <= ${asOf}::date
          AND (em.end_date IS NULL OR em.end_date >= ${asOf}::date)
      ))
    `;

    const rows = await tx<Omit<EmployeeListItem, "secondaryMemberships">[]>`
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
        ${membershipFilter()}
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
        ${membershipFilter()}
        AND (${filters.locationId ?? null}::uuid IS NULL OR e.location_id = ${filters.locationId ?? null})
        AND (${filters.status ?? null}::text IS NULL OR e.status = ${filters.status ?? null})
    `;

    const total = parseInt(countResult[0]?.count ?? "0", 10);
    const memberships = await this.activeMembershipsOf(
      tx,
      rows.map((r) => r.id),
      asOf,
    );
    return {
      items: rows.map((r) => ({
        ...r,
        secondaryMemberships: memberships.get(r.id) ?? [],
      })),
      total,
    };
  }

  /**
   * ORG-007: secondary memberships active on `date`, per employee, ordered
   * by type and name. Primary departments are not membership rows.
   */
  private async activeMembershipsOf(
    tx: TenantTx,
    employeeIds: readonly string[],
    date: string | null,
  ): Promise<Map<string, DirectoryMembershipRow[]>> {
    const byEmployee = new Map<string, DirectoryMembershipRow[]>();
    if (!date || employeeIds.length === 0) return byEmployee;
    const orgId = tx.__tenantContext.organizationId;
    const rows = await tx<(DirectoryMembershipRow & { employeeId: string })[]>`
      SELECT m.employee_id as "employeeId",
             coalesce(g.kind, 'department') as type,
             coalesce(m.department_id, m.group_id) as id,
             coalesce(d.name, g.name) as name,
             m.allocation_percent::float8 as "allocationPercent"
      FROM employee_memberships m
      LEFT JOIN departments d
        ON d.id = m.department_id AND d.organization_id = ${orgId}
      LEFT JOIN org_groups g
        ON g.id = m.group_id AND g.organization_id = ${orgId}
      WHERE m.organization_id = ${orgId}
        AND m.employee_id = ANY(${[...employeeIds]}::uuid[])
        AND m.start_date <= ${date}::date
        AND (m.end_date IS NULL OR m.end_date >= ${date}::date)
      ORDER BY type, name, id
    `;
    for (const { employeeId, ...membership } of rows) {
      const list = byEmployee.get(employeeId) ?? [];
      list.push(membership);
      byEmployee.set(employeeId, list);
    }
    return byEmployee;
  }

  /**
   * Employees of the current tenant to list in a working-time record for a
   * period of local dates (TIM-006), ordered by last name, first name. An
   * employee is included when any of these holds:
   * - an employment record overlaps the period, its end clipped to the
   *   termination date when it started on or before it (a later re-hire
   *   is not clipped, so it is not dropped);
   * - they have no employment record (hire date unknown), did not leave
   *   before the period and are not an auditor (TIM-008: auditors are not
   *   employees, but older invitations created a row for them);
   * - they have a time event in the period, in their business zone
   *   (location, else organization): recorded work is never left out of an
   *   official record because HR data disagrees.
   */
  async listEmployedDuring(
    tx: TenantTx,
    startDate: string,
    endDate: string,
  ): Promise<EmployedDuringRow[]> {
    const orgId = tx.__tenantContext.organizationId;
    return tx<EmployedDuringRow[]>`
      SELECT e.id, e.organization_id as "organizationId", e.user_id as "userId",
             e.department_id as "departmentId", e.manager_id as "managerId",
             e.location_id as "locationId",
             e.first_name as "firstName", e.last_name as "lastName"
      FROM employees e
      JOIN organizations o ON o.id = e.organization_id
      LEFT JOIN locations l
        ON l.id = e.location_id AND l.organization_id = e.organization_id
      WHERE e.organization_id = ${orgId}
        AND (
          EXISTS (
            -- Ends clipped by the termination date (EFFECTIVE_EMPLOYMENT_END),
            -- as in the export's employment days.
            SELECT 1 FROM employments x
            WHERE x.employee_id = e.id AND x.organization_id = ${orgId}
              AND x.start_date <= ${endDate}::date
              AND COALESCE(${tx.unsafe(EFFECTIVE_EMPLOYMENT_END)}, 'infinity'::date)
                >= ${startDate}::date
          )
          OR (
            NOT EXISTS (
              SELECT 1 FROM employments emp
              WHERE emp.employee_id = e.id AND emp.organization_id = ${orgId}
            )
            AND (e.termination_date IS NULL OR e.termination_date >= ${startDate}::date)
            -- Auditors were given an employee row on invitation before #39;
            -- they are not employed, so they never count as "hire date unknown".
            AND NOT EXISTS (
              SELECT 1 FROM memberships m
              WHERE m.user_id = e.user_id AND m.organization_id = ${orgId}
                AND m.role = 'auditor'
            )
          )
          OR EXISTS (
            -- Local midnights of the period in the employee's zone.
            SELECT 1 FROM time_events te
            WHERE te.employee_id = e.id AND te.organization_id = ${orgId}
              AND te.occurred_at >= (${startDate}::date::timestamp
                AT TIME ZONE COALESCE(l.timezone, o.timezone))
              AND te.occurred_at < ((${endDate}::date + 1)::timestamp
                AT TIME ZONE COALESCE(l.timezone, o.timezone))
          )
        )
      ORDER BY e.last_name, e.first_name, e.id
    `;
  }

  /**
   * Employment periods overlapping a period of local dates, per employee
   * (TIM-006); see {@link loadEmploymentPeriods}.
   */
  employmentPeriods(
    tx: TenantTx,
    employeeIds: readonly string[],
    periodStart: string,
    periodEnd: string,
  ): Promise<Map<string, EmploymentSpan[] | null>> {
    return loadEmploymentPeriods(tx, employeeIds, periodStart, periodEnd);
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
      const employmentType = data.employmentType ?? "indefinido";
      // Without an explicit start date the employment starts "today" in the
      // employee's location (else organization) time zone, never the UTC date.
      await tx`
        INSERT INTO employments (
          employee_id, job_title, employment_type, working_hours_per_week,
          start_date
        )
        SELECT
          ${emp.id},
          ${data.jobTitle},
          ${employmentType},
          ${data.workingHoursPerWeek ?? 40},
          COALESCE(
            ${data.startDate ?? null}::date,
            (now() AT TIME ZONE COALESCE(l.timezone, o.timezone))::date
          )
        FROM organizations o
        LEFT JOIN locations l
          ON l.id = ${emp.locationId ?? null}::uuid AND l.organization_id = o.id
        WHERE o.id = ${emp.organizationId}
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
    /** Only legacy SHA-256 hashes used a separate salt; scrypt hashes embed theirs. */
    pinSalt: string | null,
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

  /**
   * Replaces only the stored PIN hash, e.g. to upgrade a legacy SHA-256 hash
   * to scrypt after a successful kiosk login. Badge and other fields are kept.
   */
  async upgradeKioskPinHash(
    tx: TenantTx,
    employeeId: string,
    pinHash: string,
  ): Promise<void> {
    await tx`
      UPDATE employees
      SET pin_hash = ${pinHash},
          pin_salt = NULL,
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
