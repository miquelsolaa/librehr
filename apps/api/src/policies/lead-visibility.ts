import type { Permission } from "@librehr/contracts";
import { permissionScope, type PolicyUserContext } from "./can.js";

/**
 * ORG-007 (ADR 0008 decision 8): the read permissions a department or group
 * lead may exercise on its members when the organization's lead visibility
 * is `profile`. An allow-list, so write, approval and sensitive-field
 * permissions can never be reached this way.
 *
 * `leave.request.read` is not on it: `calendar` (and `profile`) show members'
 * absences masked as "Away", which the team calendar already shows to every
 * colleague, so no extra permission is needed for that.
 */
export const LEAD_READABLE: ReadonlySet<Permission> = new Set([
  "employee.read",
]);

/**
 * Whether the user may read an employee as the lead of one of their
 * departments, projects or areas. It widens who, never what: the role must
 * already hold the permission at some scope, and callers limit the response
 * to directory fields.
 *
 * @example
 * canReadAsLead(ctx, "employee.read", employee.id); // profile setting only
 * canReadAsLead(ctx, "employee.write", employee.id); // always false
 */
export function canReadAsLead(
  ctx: PolicyUserContext,
  permission: Permission,
  employeeId: string,
): boolean {
  if (!LEAD_READABLE.has(permission)) return false;
  if (ctx.leadVisibility !== "profile") return false;
  if (permissionScope(ctx, permission) === null) return false;
  return ctx.ledMemberIds?.includes(employeeId) ?? false;
}
