import type { TenantTx } from "../with-tenant.js";

export interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
  defaultLocale: string;
  timezone: string;
  requireTwoFactor: boolean;
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
        require_two_factor as "requireTwoFactor"
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
        require_two_factor as "requireTwoFactor"
      FROM organizations
      WHERE slug = ${slug}
      LIMIT 1
    `;
    return rows[0] ?? null;
  }

  async updateSecuritySettings(
    tx: TenantTx,
    id: string,
    settings: { requireTwoFactor: boolean },
  ): Promise<void> {
    await tx`
      UPDATE organizations
      SET
        require_two_factor = ${settings.requireTwoFactor},
        updated_at = now()
      WHERE id = ${id}
    `;
  }
}
