import type { TenantTx } from "../with-tenant.js";

export interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
  defaultLocale: string;
  timezone: string;
}

export class OrganizationRepository {
  async findById(tx: TenantTx, id: string): Promise<OrganizationRow | null> {
    const rows = await tx<OrganizationRow[]>`
      SELECT id, name, slug, default_locale as "defaultLocale", timezone
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
      SELECT id, name, slug, default_locale as "defaultLocale", timezone
      FROM organizations
      WHERE slug = ${slug}
      LIMIT 1
    `;
    return rows[0] ?? null;
  }
}
