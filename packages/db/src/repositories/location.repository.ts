import type { TenantTx } from "../with-tenant.js";

export interface LocationRow {
  id: string;
  organizationId: string;
  legalEntityId: string | null;
  name: string;
  country: string;
  region: string;
  city: string;
  timezone: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface LegalEntityRow {
  id: string;
  organizationId: string;
  name: string;
  taxId: string;
  country: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateLocationData {
  legalEntityId?: string | null | undefined;
  name: string;
  country?: string | undefined;
  region?: string | undefined;
  city: string;
  timezone?: string | undefined;
}

export interface CreateLegalEntityData {
  name: string;
  taxId: string;
  country?: string | undefined;
}

export class LocationRepository {
  async findLocations(tx: TenantTx): Promise<LocationRow[]> {
    return tx<LocationRow[]>`
      SELECT id, organization_id as "organizationId", legal_entity_id as "legalEntityId",
             name, country, region, city, timezone,
             created_at as "createdAt", updated_at as "updatedAt"
      FROM locations
      ORDER BY name ASC
    `;
  }

  async createLocation(
    tx: TenantTx,
    data: CreateLocationData,
  ): Promise<LocationRow> {
    const rows = await tx<LocationRow[]>`
      INSERT INTO locations (
        legal_entity_id, name, country, region, city, timezone
      ) VALUES (
        ${data.legalEntityId ?? null},
        ${data.name},
        ${data.country ?? "ES"},
        ${data.region ?? "CT"},
        ${data.city},
        ${data.timezone ?? "Europe/Madrid"}
      )
      RETURNING id, organization_id as "organizationId", legal_entity_id as "legalEntityId",
                name, country, region, city, timezone,
                created_at as "createdAt", updated_at as "updatedAt"
    `;
    return rows[0]!;
  }

  async findLegalEntities(tx: TenantTx): Promise<LegalEntityRow[]> {
    return tx<LegalEntityRow[]>`
      SELECT id, organization_id as "organizationId", name, tax_id as "taxId",
             country, created_at as "createdAt", updated_at as "updatedAt"
      FROM legal_entities
      ORDER BY name ASC
    `;
  }

  async createLegalEntity(
    tx: TenantTx,
    data: CreateLegalEntityData,
  ): Promise<LegalEntityRow> {
    const rows = await tx<LegalEntityRow[]>`
      INSERT INTO legal_entities (name, tax_id, country)
      VALUES (${data.name}, ${data.taxId}, ${data.country ?? "ES"})
      RETURNING id, organization_id as "organizationId", name, tax_id as "taxId",
                country, created_at as "createdAt", updated_at as "updatedAt"
    `;
    return rows[0]!;
  }
}
