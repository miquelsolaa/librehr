import type {
  EmployeeListItem,
  EmployeeProfile,
  Permission,
} from "@librehr/contracts";
import type {
  EmployeeListItem as EmployeeListRow,
  EmployeeProfile as EmployeeProfileRow,
} from "@librehr/db";
import { can, permissionScope, type PolicyUserContext } from "./can.js";

/**
 * Field-level visibility of an employee profile (EMP-004):
 * - "full": the employee themselves, and organization-scoped readers (HR/admin).
 * - "job": a manager looking at a report: job and contact data, no personal
 *   data (address, birth date).
 * Sensitive fields (national id, IBAN) are never part of a profile response;
 * only their presence is. Values are revealed through the audited
 * `POST /employees/:id/reveal` endpoint.
 */
export type EmployeeProfileView = "full" | "job";

export function employeeProfileView(
  ctx: PolicyUserContext,
  employee: EmployeeProfileRow,
): EmployeeProfileView | null {
  const resource = {
    organizationId: employee.organizationId,
    employeeId: employee.id,
    userId: employee.userId ?? undefined,
    managerId: employee.managerId ?? undefined,
    departmentId: employee.departmentId ?? undefined,
    locationId: employee.locationId ?? undefined,
  };
  if (!can(ctx, "employee.read", resource)) return null;
  const isSelf =
    employee.id === ctx.employeeId ||
    (employee.userId !== null && employee.userId === ctx.userId);
  if (isSelf || permissionScope(ctx, "employee.read") === "organization") {
    return "full";
  }
  return "job";
}

/** Shapes a profile row for the API, dropping ciphertext and internal columns. */
export function toEmployeeProfile(
  row: EmployeeProfileRow,
  view: EmployeeProfileView,
): EmployeeProfile {
  const personal = view === "full";
  return {
    id: row.id,
    organizationId: row.organizationId,
    userId: row.userId,
    departmentId: row.departmentId,
    managerId: row.managerId,
    locationId: row.locationId,
    firstName: row.firstName,
    lastName: row.lastName,
    preferredName: row.preferredName,
    email: row.email,
    phone: row.phone,
    address: personal ? row.address : null,
    birthDate: personal ? row.birthDate : null,
    status: row.status,
    terminationDate: row.terminationDate,
    terminationReason: row.terminationReason,
    departmentName: row.departmentName,
    locationName: row.locationName,
    managerName: row.managerName,
    jobTitle: row.jobTitle,
    employmentType: row.employmentType,
    startDate: row.startDate,
    hasNationalId: Boolean(row.nationalIdEncrypted),
    hasIban: Boolean(row.ibanEncrypted),
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

/** Directory entry (EMP-001): the fields every colleague may see. */
export function toDirectoryEntry(row: EmployeeListRow): EmployeeListItem {
  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    preferredName: row.preferredName,
    email: row.email,
    status: row.status,
    departmentName: row.departmentName,
    locationName: row.locationName,
    jobTitle: row.jobTitle,
    managerName: row.managerName,
  };
}

/**
 * The directory and org chart are visible to anyone holding the permission
 * at any scope (EMP-001); the response is limited to directory fields.
 */
export function canSeeDirectory(
  ctx: PolicyUserContext,
  permission: Permission = "employee.read",
): boolean {
  return permissionScope(ctx, permission) !== null;
}
