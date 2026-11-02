import {
  type Permission,
  type Scope,
  ROLE_PERMISSIONS,
} from "@librehr/contracts";

export interface PolicyUserContext {
  userId: string;
  employeeId?: string | undefined;
  organizationId: string;
  role: string;
  departmentId?: string | undefined;
  locationId?: string | undefined;
  reports?: string[] | undefined; // list of employeeIds who report directly to this user
}

export interface PolicyResource {
  organizationId: string;
  userId?: string | undefined;
  employeeId?: string | undefined;
  managerId?: string | undefined;
  departmentId?: string | undefined;
  locationId?: string | undefined;
}

/**
 * Checks whether the current user is authorized to perform a permission on a given resource
 * according to role permissions and operational scope (self, reports, department, location, organization).
 */
export function can(
  ctx: PolicyUserContext,
  permission: Permission,
  resource?: PolicyResource,
): boolean {
  // 1. Cross-tenant isolation check: Resource must belong to the user's active organization
  if (resource && resource.organizationId !== ctx.organizationId) {
    return false;
  }

  // 2. Lookup permissions for the user's role
  const permissions = ROLE_PERMISSIONS[ctx.role] ?? [];
  const matched = permissions.find((p) => p.permission === permission);

  if (!matched) {
    return false;
  }

  // 3. If no specific resource was provided (e.g. list view), permission existence is enough
  if (!resource) {
    return true;
  }

  // 4. Scope matching
  return checkScope(matched.scope, ctx, resource);
}

function checkScope(
  scope: Scope,
  ctx: PolicyUserContext,
  resource: PolicyResource,
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
      if (resource.userId && resource.userId === ctx.userId) return true;
      if (resource.managerId && resource.managerId === ctx.userId) return true;
      if (
        resource.employeeId &&
        ctx.reports &&
        ctx.reports.includes(resource.employeeId)
      ) {
        return true;
      }
      return false;

    case "self":
      return (
        (Boolean(resource.userId) && resource.userId === ctx.userId) ||
        (Boolean(resource.employeeId) && resource.employeeId === ctx.employeeId)
      );

    default:
      return false;
  }
}
