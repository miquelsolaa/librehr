import type { CustomFieldVisibility } from "@librehr/contracts";
import { permissionScope, type PolicyUserContext } from "./can.js";
import { canOnEmployee, type ScopedEmployee } from "./context.js";

/** How the caller relates to the employee whose custom fields are read. */
export type CustomFieldViewer = "admin" | "hr" | "manager" | "self";

/**
 * ORG-005: who may read an employee's custom fields at all. Returns the
 * strongest relationship, or null for colleagues outside the caller's scope.
 * "hr" is any organization-scoped employee reader; "admin" is the admin role.
 */
export function customFieldViewer(
  ctx: PolicyUserContext,
  employee: ScopedEmployee,
): CustomFieldViewer | null {
  if (!canOnEmployee(ctx, "employee.read", employee)) return null;
  if (permissionScope(ctx, "employee.read") === "organization") {
    return ctx.role === "admin" ? "admin" : "hr";
  }
  if (employee.id === ctx.employeeId) return "self";
  return "manager";
}

const VISIBLE_TO: Record<CustomFieldVisibility, readonly CustomFieldViewer[]> =
  {
    public: ["admin", "hr", "manager", "self"],
    employee: ["admin", "hr", "manager", "self"],
    manager: ["admin", "hr", "manager"],
    hr: ["admin", "hr"],
    admin: ["admin"],
  };

/**
 * Applies a field definition's visibility rule. Unknown visibility values
 * fail closed to admin-only.
 */
export function canSeeCustomField(
  viewer: CustomFieldViewer,
  visibility: string | undefined,
): boolean {
  const allowed =
    VISIBLE_TO[(visibility ?? "admin") as CustomFieldVisibility] ??
    VISIBLE_TO.admin;
  return allowed.includes(viewer);
}

/**
 * Writing custom field values is HR/admin only: definitions have no
 * "self-editable" flag, so employees cannot edit their own values.
 */
export function canWriteCustomFields(
  ctx: PolicyUserContext,
  employee: ScopedEmployee,
): boolean {
  return (
    permissionScope(ctx, "employee.write") === "organization" &&
    canOnEmployee(ctx, "employee.write", employee)
  );
}
