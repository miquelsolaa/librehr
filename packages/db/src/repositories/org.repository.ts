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
