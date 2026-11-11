import { Hono } from "hono";
import type { Sql } from "postgres";
import {
  type AuthUser,
  type ExportEmployeesResponse,
  ExportEmployeesQuerySchema,
} from "@librehr/contracts";
import { withTenant, AuditRepository, EmployeeRepository } from "@librehr/db";
import { requireAuth } from "../middleware/auth.js";
import { createRateLimiter } from "../middleware/rate-limit.js";
import { employeeIdsInScope, permissionScope } from "../policies/can.js";
import { resolvePolicyContext } from "../policies/context.js";
import { ForbiddenError } from "../errors/index.js";
import { parseQuery } from "../lib/validate.js";
import { exportEmployeeName } from "../lib/time-export.js";

/**
 * Default picker rate limit, per user and client address. More generous than
 * the export's: the page reloads the list on every date change.
 */
const DEFAULT_RATE_LIMIT = { windowMs: 60_000, max: 60 };

/** Picker order: Spanish collation, case and accent insensitive. */
export const EXPORT_EMPLOYEE_COLLATOR = new Intl.Collator("es", {
  sensitivity: "base",
});

export interface TimeExportEmployeesRouteOptions {
  /** TRUST_PROXY: reverse-proxy hops whose X-Forwarded-For entries are trusted. */
  trustProxy?: number | undefined;
  /** Overrides the default of 60 requests per minute (tests). */
  rateLimit?: { windowMs: number; max: number } | undefined;
}

const currentUser = (c: { get: unknown }) =>
  (c.get as (key: string) => unknown)("user") as AuthUser;

/**
 * TIM-006 / TIM-008: employee picker of the working-time export, i.e. whom
 * the caller may export for a period (time.record.read scope). Not gated on
 * employee.read: an auditor holds none and still picks one employee.
 */
export function createTimeExportEmployeesRoutes(
  sql: Sql,
  options: TimeExportEmployeesRouteOptions = {},
) {
  const router = new Hono();
  const pickerLimit = createRateLimiter({
    ...(options.rateLimit ?? DEFAULT_RATE_LIMIT),
    trustProxy: options.trustProxy,
    account: (c) => currentUser(c).id,
  });
  const employeeRepo = new EmployeeRepository();
  const auditRepo = new AuditRepository();

  router.get("/time/export/employees", requireAuth, pickerLimit, async (c) => {
    const user = currentUser(c);
    const { startDate, endDate } = parseQuery(c, ExportEmployeesQuerySchema);

    const body = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx): Promise<ExportEmployeesResponse> => {
        const ctx = await resolvePolicyContext(c, tx);
        const scope = permissionScope(ctx, "time.record.read");
        if (!scope) {
          throw new ForbiddenError({
            detail: "You do not have permission to export time records",
          });
        }
        // Same set as an organization export, narrowed to the caller's scope.
        const inScope = employeeIdsInScope(ctx, "time.record.read");
        const allowed = inScope === "all" ? null : new Set(inScope);
        const employed = await employeeRepo.listEmployedDuring(
          tx,
          startDate,
          endDate,
        );
        const items = employed
          .filter((e) => allowed === null || allowed.has(e.id))
          .map((e) => ({ id: e.id, name: exportEmployeeName(e) }))
          .sort((x, y) => EXPORT_EMPLOYEE_COLLATOR.compare(x.name, y.name));

        // TIM-008 full access logging: organization-wide time access
        // without directory access (an inspector) reveals who was employed
        // in the period, so each listing is audited. Counts only, no PII.
        if (
          scope === "organization" &&
          !permissionScope(ctx, "employee.read")
        ) {
          await auditRepo.log(tx, {
            actorId: user.id,
            action: "inspector.export_picker_access",
            resourceType: "time_export",
            metadata: {
              periodStart: startDate,
              periodEnd: endDate,
              employeeCount: items.length,
            },
          });
        }
        return { items };
      },
    );
    return c.json(body, 200, { "Cache-Control": "no-store" });
  });

  return router;
}
