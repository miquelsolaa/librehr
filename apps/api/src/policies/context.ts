import type { Context } from "hono";
import type { AuthUser, Permission } from "@librehr/contracts";
import { todayInZone } from "@librehr/core";
import {
  EmployeeMembershipRepository,
  EmployeeRepository,
  OrganizationRepository,
  type TenantTx,
} from "@librehr/db";
import { SystemClockAdapter } from "../adapters/clock-system.js";
import { ForbiddenError, NotFoundError } from "../errors/index.js";
import type { ClockPort } from "../ports/clock.js";
import { can, employeeIdsInScope, type PolicyUserContext } from "./can.js";

const employeeRepo = new EmployeeRepository();
const membershipRepo = new EmployeeMembershipRepository();
const orgRepo = new OrganizationRepository();
const systemClock: ClockPort = new SystemClockAdapter();
const CACHE_KEY = "policyContext";

/**
 * Builds the policy context for a user: linked employee, direct reports and,
 * for ORG-007, the departments they work in today and the members they lead
 * (only when the organization lets leads see profiles).
 */
export async function loadPolicyContext(
  tx: TenantTx,
  user: AuthUser,
  clock: ClockPort = systemClock,
): Promise<PolicyUserContext> {
  const identity = await employeeRepo.findPolicyIdentity(tx, user.id);
  const ctx: PolicyUserContext = {
    userId: user.id,
    organizationId: user.organizationId,
    role: user.role,
    employeeId: identity?.employeeId,
    departmentId: identity?.departmentId ?? undefined,
    locationId: identity?.locationId ?? undefined,
    reports: identity?.reports ?? [],
  };
  if (!identity) return ctx;

  const settings = await orgRepo.getPolicySettings(tx, identity.locationId);
  // Without settings nothing beyond the role is granted (fail closed).
  if (!settings) return ctx;
  // Memberships are calendar dates in the organization's (or location's)
  // time zone, so "active" is judged on the business date, never UTC.
  const today = todayInZone(settings.timeZone, clock);
  const active = await membershipRepo.listActiveOn(
    tx,
    identity.employeeId,
    today,
  );
  const secondary = active.flatMap((m) =>
    m.departmentId ? [m.departmentId] : [],
  );
  ctx.departmentIds = [
    ...new Set([
      ...(identity.departmentId ? [identity.departmentId] : []),
      ...secondary,
    ]),
  ];
  ctx.leadVisibility = settings.secondaryLeadVisibility;
  if (settings.secondaryLeadVisibility === "profile") {
    ctx.ledMemberIds = await membershipRepo.listMembersLedBy(
      tx,
      identity.employeeId,
      today,
    );
  }
  return ctx;
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

/** {@link requireEmployeeInScope} for every distinct id in a batch. */
export async function requireEmployeesInScope<E extends ScopedEmployee>(
  ctx: PolicyUserContext,
  permission: Permission,
  ids: readonly string[],
  load: (id: string) => Promise<E | null>,
): Promise<void> {
  for (const id of new Set(ids)) {
    await requireEmployeeInScope(ctx, permission, () => load(id));
  }
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
