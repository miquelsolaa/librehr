import type { TenantTx } from "../with-tenant.js";

export interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
  defaultLocale: string;
  timezone: string;
  requireTwoFactor: boolean;
  /** TIM-008: how many days ahead an auditor's access end date may be. */
  auditorAccessMaxDays: number;
}

export interface OrganizationSecuritySettingsUpdate {
  requireTwoFactor?: boolean | undefined;
  auditorAccessMaxDays?: number | undefined;
}

export class OrganizationRepository {
  async findById(tx: TenantTx, id: string): Promise<OrganizationRow | null> {
    const rows = await tx<OrganizationRow[]>`
      SELECT
        id,
        name,
        slug,
        default_locale as "defaultLocale",
        timezone,
        require_two_factor as "requireTwoFactor",
        auditor_access_max_days as "auditorAccessMaxDays"
      FROM organizations
      WHERE id = ${id}
      LIMIT 1
    `;
    return rows[0] ?? null;
  }

  /**
   * IANA time zone that business dates follow (ORG-001/ADM-003): the
   * location's when one is given and set, else the organization's.
   */
  async getBusinessTimeZone(
    tx: TenantTx,
    locationId?: string | null | undefined,
  ): Promise<string> {
    const rows = await tx<{ timezone: string }[]>`
      SELECT COALESCE(l.timezone, o.timezone) AS timezone
      FROM organizations o
      LEFT JOIN locations l
        ON l.id = ${locationId ?? null}::uuid AND l.organization_id = o.id
      WHERE o.id = ${tx.__tenantContext.organizationId}
      LIMIT 1
    `;
    const zone = rows[0]?.timezone;
    if (!zone) throw new Error("Organization not found for tenant context");
    return zone;
  }

  async findBySlug(
    tx: TenantTx,
    slug: string,
  ): Promise<OrganizationRow | null> {
    const rows = await tx<OrganizationRow[]>`
      SELECT
        id,
        name,
        slug,
        default_locale as "defaultLocale",
        timezone,
        require_two_factor as "requireTwoFactor",
        auditor_access_max_days as "auditorAccessMaxDays"
      FROM organizations
      WHERE slug = ${slug}
      LIMIT 1
    `;
    return rows[0] ?? null;
  }

  /**
   * Partial update: a setting left undefined keeps its stored value.
   * Returns the settings as stored afterwards, or null for an unknown id.
   */
  async updateSecuritySettings(
    tx: TenantTx,
    id: string,
    settings: OrganizationSecuritySettingsUpdate,
  ): Promise<{
    requireTwoFactor: boolean;
    auditorAccessMaxDays: number;
  } | null> {
    const rows = await tx<
      { requireTwoFactor: boolean; auditorAccessMaxDays: number }[]
    >`
      UPDATE organizations
      SET
        require_two_factor = COALESCE(${settings.requireTwoFactor ?? null}::boolean, require_two_factor),
        auditor_access_max_days = COALESCE(${settings.auditorAccessMaxDays ?? null}::integer, auditor_access_max_days),
        updated_at = now()
      WHERE id = ${id}
      RETURNING require_two_factor AS "requireTwoFactor",
                auditor_access_max_days AS "auditorAccessMaxDays"
    `;
    return rows[0] ?? null;
  }
}
