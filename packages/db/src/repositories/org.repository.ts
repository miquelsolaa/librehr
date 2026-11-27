import type { TenantTx } from "../with-tenant.js";

/** ORG-007: read access of department and group leads to their members. */
export type SecondaryLeadVisibility = "off" | "calendar" | "profile";

export interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
  defaultLocale: string;
  timezone: string;
  requireTwoFactor: boolean;
  /** TIM-008: how many days ahead an auditor's access end date may be. */
  auditorAccessMaxDays: number;
  secondaryLeadVisibility: SecondaryLeadVisibility;
}

export interface OrganizationSecuritySettingsUpdate {
  requireTwoFactor?: boolean | undefined;
  auditorAccessMaxDays?: number | undefined;
  secondaryLeadVisibility?: SecondaryLeadVisibility | undefined;
}

/** Settings an authorization check needs, read in one query. */
export interface PolicySettings {
  /** Business time zone: the location's when given and set, else the org's. */
  timeZone: string;
  secondaryLeadVisibility: SecondaryLeadVisibility;
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
        auditor_access_max_days as "auditorAccessMaxDays",
        secondary_lead_visibility as "secondaryLeadVisibility"
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

  /**
   * {@link getBusinessTimeZone} plus the lead visibility setting (ORG-007).
   * Null when the tenant's organization row is not found.
   */
  async getPolicySettings(
    tx: TenantTx,
    locationId?: string | null | undefined,
  ): Promise<PolicySettings | null> {
    const rows = await tx<PolicySettings[]>`
      SELECT COALESCE(l.timezone, o.timezone) AS "timeZone",
             o.secondary_lead_visibility AS "secondaryLeadVisibility"
      FROM organizations o
      LEFT JOIN locations l
        ON l.id = ${locationId ?? null}::uuid AND l.organization_id = o.id
      WHERE o.id = ${tx.__tenantContext.organizationId}
      LIMIT 1
    `;
    return rows[0] ?? null;
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
        auditor_access_max_days as "auditorAccessMaxDays",
        secondary_lead_visibility as "secondaryLeadVisibility"
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
    secondaryLeadVisibility: SecondaryLeadVisibility;
  } | null> {
    const rows = await tx<
      {
        requireTwoFactor: boolean;
        auditorAccessMaxDays: number;
        secondaryLeadVisibility: SecondaryLeadVisibility;
      }[]
    >`
      UPDATE organizations
      SET
        require_two_factor = COALESCE(${settings.requireTwoFactor ?? null}::boolean, require_two_factor),
        auditor_access_max_days = COALESCE(${settings.auditorAccessMaxDays ?? null}::integer, auditor_access_max_days),
        secondary_lead_visibility = COALESCE(${settings.secondaryLeadVisibility ?? null}::text, secondary_lead_visibility),
        updated_at = now()
      WHERE id = ${id}
      RETURNING require_two_factor AS "requireTwoFactor",
                auditor_access_max_days AS "auditorAccessMaxDays",
                secondary_lead_visibility AS "secondaryLeadVisibility"
    `;
    return rows[0] ?? null;
  }
}
