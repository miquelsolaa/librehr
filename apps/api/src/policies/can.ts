import {
  type Permission,
  type Scope,
  ROLE_PERMISSIONS,
} from "@librehr/contracts";

export interface PolicyUserContext {
  userId: string;
  /** Employee linked to the user in the current organization, if any. */
  employeeId?: string | undefined;
  organizationId: string;
  role: string;
  departmentId?: string | undefined;
  locationId?: string | undefined;
  /** Employee ids of the user's direct reports. */
  reports?: string[] | undefined;
}

export interface PolicyResource {
  organizationId: string;
  userId?: string | undefined;
  employeeId?: string | undefined;
  /** Employee id (never a user id) of the subject's manager. */
  managerId?: string | undefined;
  departmentId?: string | undefined;
  locationId?: string | undefined;
}

/** Returns the scope the role holds for a permission, or null when it lacks it. */
export function permissionScope(
  ctx: PolicyUserContext,
  permission: Permission,
): Scope | null {
  const permissions = ROLE_PERMISSIONS[ctx.role] ?? [];
  return permissions.find((p) => p.permission === permission)?.scope ?? null;
}

/**
 * Checks whether the current user may perform a permission on a resource,
 * according to role permissions and scope (self, reports, department,
 * location, organization).
 *
 * Without a resource the check answers "may the user do this across the whole
 * organization?", so it only passes for organization-scoped permissions. List
 * views available to narrower scopes must filter with `employeeIdsInScope` or
 * check each row with a resource instead.
 *
 * @example
 * can(ctx, "employee.read"); // true only for organization scope
 * can(ctx, "employee.read", { organizationId, employeeId }); // scope-aware
 */
export function can(
  ctx: PolicyUserContext,
  permission: Permission,
  resource?: PolicyResource,
): boolean {
  // Cross-tenant isolation: the resource must belong to the active organization.
  if (resource && resource.organizationId !== ctx.organizationId) {
    return false;
  }

  const scope = permissionScope(ctx, permission);
  if (!scope) return false;

  if (!resource) return scope === "organization";

  return checkScope(scope, ctx, resource, permission);
}

/**
 * Approval-style permissions that a reports-scoped holder (a manager) must
 * not exercise on their own records: approving your own leave or your own
 * time correction is not a manager decision.
 */
const NOT_SELF_APPROVABLE: ReadonlySet<Permission> = new Set([
  "leave.request.approve",
  "time.record.correct",
]);

/**
 * Employee ids a list view may include for a permission: "all" for
 * organization scope, otherwise an explicit allow-list (possibly empty).
 * Department and location scopes are not used by any built-in role and fail
 * closed here until a caller needs them.
 */
export function employeeIdsInScope(
  ctx: PolicyUserContext,
  permission: Permission,
): "all" | string[] {
  const scope = permissionScope(ctx, permission);
  if (scope === "organization") return "all";
  const self = ctx.employeeId ? [ctx.employeeId] : [];
  if (scope === "self") return self;
  if (scope === "reports") return [...self, ...(ctx.reports ?? [])];
  return [];
}

function checkScope(
  scope: Scope,
  ctx: PolicyUserContext,
  resource: PolicyResource,
  permission: Permission,
): boolean {
  switch (scope) {
    case "organization":
      return resource.organizationId === ctx.organizationId;

    case "location":
      return Boolean(ctx.locationId) && ctx.locationId === resource.locationId;

    case "department":
      return (
        Boolean(ctx.departmentId) && ctx.departmentId === resource.departmentId
      );

    case "reports":
      if (isSelf(ctx, resource)) return !NOT_SELF_APPROVABLE.has(permission);
      if (
        ctx.employeeId &&
        resource.managerId &&
        resource.managerId === ctx.employeeId
      ) {
        return true;
      }
      return Boolean(
        resource.employeeId && ctx.reports?.includes(resource.employeeId),
      );

    case "self":
      return isSelf(ctx, resource);

    default:
      return false;
  }
}

function isSelf(ctx: PolicyUserContext, resource: PolicyResource): boolean {
  return (
    (Boolean(resource.userId) && resource.userId === ctx.userId) ||
    (Boolean(resource.employeeId) && resource.employeeId === ctx.employeeId)
  );
}
