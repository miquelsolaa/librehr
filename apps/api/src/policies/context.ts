import type { Context } from "hono";
import type { AuthUser, Permission } from "@librehr/contracts";
import { EmployeeRepository, type TenantTx } from "@librehr/db";
import { ForbiddenError, NotFoundError } from "../errors/index.js";
import { can, employeeIdsInScope, type PolicyUserContext } from "./can.js";

const employeeRepo = new EmployeeRepository();
const CACHE_KEY = "policyContext";

/** Builds the policy context for a user: linked employee and direct reports. */
export async function loadPolicyContext(
  tx: TenantTx,
  user: AuthUser,
): Promise<PolicyUserContext> {
  const identity = await employeeRepo.findPolicyIdentity(tx, user.id);
  return {
    userId: user.id,
    organizationId: user.organizationId,
    role: user.role,
    employeeId: identity?.employeeId,
    departmentId: identity?.departmentId ?? undefined,
    locationId: identity?.locationId ?? undefined,
    reports: identity?.reports ?? [],
  };
}

/**
 * Returns the policy context for the authenticated user, loading it at most
 * once per request. Every route that checks a scoped permission resolves the
 * context through here so "self" and "reports" scopes see the same identity.
 */
export async function resolvePolicyContext(
  c: Context,
  tx: TenantTx,
): Promise<PolicyUserContext> {
  const get = c.get as (key: string) => unknown;
  const cached = get(CACHE_KEY) as PolicyUserContext | undefined;
  if (cached) return cached;
  const user = get("user") as AuthUser;
  const ctx = await loadPolicyContext(tx, user);
  (c.set as (key: string, value: unknown) => void)(CACHE_KEY, ctx);
  return ctx;
}

export interface EmployeeListFilter {
  /** Single employee to query for, when one is requested or implied. */
  employeeId: string | undefined;
  /** Employees whose rows may be returned. */
  allowed: "all" | ReadonlySet<string>;
}

/**
 * Turns a list endpoint's optional `employeeId` filter into a scope-safe
 * filter. Asking for an employee outside the caller's scope is a 403; with no
 * filter, narrower scopes are limited to self (and direct reports).
 */
export function scopedEmployeeFilter(
  ctx: PolicyUserContext,
  permission: Permission,
  requestedId?: string | undefined,
): EmployeeListFilter {
  const ids = employeeIdsInScope(ctx, permission);
  if (ids === "all") return { employeeId: requestedId, allowed: "all" };
  const allowed = new Set(ids);
  if (requestedId !== undefined) {
    if (!allowed.has(requestedId)) {
      throw new ForbiddenError({
        detail: "This employee is outside your access scope",
      });
    }
    return { employeeId: requestedId, allowed };
  }
  return { employeeId: ids.length === 1 ? ids[0] : undefined, allowed };
}

/** Whether a row's employee passes a scoped list filter. */
export function inEmployeeFilter(
  filter: EmployeeListFilter,
  employeeId: string,
): boolean {
  return filter.allowed === "all" || filter.allowed.has(employeeId);
}

/** The scope-relevant fields of an employee row. */
export interface ScopedEmployee {
  id: string;
  organizationId: string;
  userId: string | null;
  managerId: string | null;
  departmentId: string | null;
  locationId: string | null;
}

/** Checks a permission against a specific employee as the resource. */
export function canOnEmployee(
  ctx: PolicyUserContext,
  permission: Permission,
  employee: ScopedEmployee,
): boolean {
  return can(ctx, permission, {
    organizationId: employee.organizationId,
    employeeId: employee.id,
    userId: employee.userId ?? undefined,
    managerId: employee.managerId ?? undefined,
    departmentId: employee.departmentId ?? undefined,
    locationId: employee.locationId ?? undefined,
  });
}

/**
 * Loads an employee and checks a permission on it, following the API
 * convention: unknown or other-tenant ids are 404 (the tenant-filtered lookup
 * finds nothing), known ids outside the caller's scope are 403.
 */
export async function requireEmployeeInScope<E extends ScopedEmployee>(
  ctx: PolicyUserContext,
  permission: Permission,
  load: () => Promise<E | null>,
  notFoundCode = "NOT_FOUND",
): Promise<E> {
  const employee = await load();
  if (!employee) {
    throw new NotFoundError({
      detail: "Employee not found",
      code: notFoundCode,
    });
  }
  if (!canOnEmployee(ctx, permission, employee)) {
    throw new ForbiddenError({
      detail: "This employee is outside your access scope",
    });
  }
  return employee;
}
