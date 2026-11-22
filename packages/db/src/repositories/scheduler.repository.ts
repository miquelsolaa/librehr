import type { Sql } from "postgres";
import type { TenantTx } from "../with-tenant.js";

/** One organization as the scheduler sees it: its id and IANA zone only. */
export interface ScheduledOrganization {
  organizationId: string;
  timeZone: string;
}

/**
 * Reads for the worker's job scheduler (issue #115).
 *
 * `listOrganizations` is the scheduler's only read without a tenant context.
 * It calls the SECURITY DEFINER function of migration 0035, which returns ids
 * and time zones only and is executable by the worker's role (the owner), not
 * by the API's runtime role.
 */
export class SchedulerRepository {
  async listOrganizations(sql: Sql): Promise<ScheduledOrganization[]> {
    return sql<ScheduledOrganization[]>`
      SELECT organization_id AS "organizationId", timezone AS "timeZone"
      FROM librehr_scheduler_organizations()
    `;
  }

  /** Distinct zones of the tenant's locations (RLS-scoped). */
  async listLocationTimeZones(tx: TenantTx): Promise<string[]> {
    const rows = await tx<{ timezone: string }[]>`
      SELECT DISTINCT timezone FROM locations
      WHERE organization_id = ${tx.__tenantContext.organizationId}
      ORDER BY timezone
    `;
    return rows.map((r) => r.timezone);
  }
}
