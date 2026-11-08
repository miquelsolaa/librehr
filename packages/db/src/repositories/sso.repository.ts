import type { TenantTx } from "../with-tenant.js";

export interface SsoConfigRow {
  id: string;
  organizationId: string;
  provider: string;
  clientId: string;
  clientSecret: string;
  issuerUrl: string;
  enabled: boolean;
  enforceSso: boolean;
  allowedDomains: string[];
  createdAt: Date;
  updatedAt: Date;
}

function parseDomains(domains: unknown): string[] {
  if (Array.isArray(domains)) {
    return domains as string[];
  }
  if (typeof domains === "string") {
    try {
      const parsed = JSON.parse(domains);
      if (Array.isArray(parsed)) return parsed as string[];
    } catch {
      // ignore
    }
  }
  return [];
}

export class SsoRepository {
  async getConfig(tx: TenantTx): Promise<SsoConfigRow | null> {
    const rows = await tx<SsoConfigRow[]>`
      SELECT
        id,
        organization_id as "organizationId",
        provider,
        client_id as "clientId",
        client_secret as "clientSecret",
        issuer_url as "issuerUrl",
        enabled,
        enforce_sso as "enforceSso",
        allowed_domains as "allowedDomains",
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM sso_configurations
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) return null;
    return {
      ...row,
      allowedDomains: parseDomains(row.allowedDomains),
    };
  }

  async saveConfig(
    tx: TenantTx,
    data: {
      provider: string;
      clientId: string;
      clientSecret: string;
      issuerUrl: string;
      enabled: boolean;
      enforceSso: boolean;
      allowedDomains: string[];
    },
  ): Promise<SsoConfigRow> {
    const existing = await this.getConfig(tx);
    if (existing) {
      const rows = await tx<SsoConfigRow[]>`
        UPDATE sso_configurations
        SET
          provider = ${data.provider},
          client_id = ${data.clientId},
          client_secret = ${data.clientSecret},
          issuer_url = ${data.issuerUrl},
          enabled = ${data.enabled},
          enforce_sso = ${data.enforceSso},
          allowed_domains = ${tx.json(data.allowedDomains)},
          updated_at = now()
        WHERE id = ${existing.id}
        RETURNING
          id,
          organization_id as "organizationId",
          provider,
          client_id as "clientId",
          client_secret as "clientSecret",
          issuer_url as "issuerUrl",
          enabled,
          enforce_sso as "enforceSso",
          allowed_domains as "allowedDomains",
          created_at as "createdAt",
          updated_at as "updatedAt"
      `;
      const row = rows[0]!;
      return {
        ...row,
        allowedDomains: parseDomains(row.allowedDomains),
      };
    }

    const rows = await tx<SsoConfigRow[]>`
      INSERT INTO sso_configurations (
        provider, client_id, client_secret, issuer_url,
        enabled, enforce_sso, allowed_domains
      ) VALUES (
        ${data.provider},
        ${data.clientId},
        ${data.clientSecret},
        ${data.issuerUrl},
        ${data.enabled},
        ${data.enforceSso},
        ${tx.json(data.allowedDomains)}
      )
      RETURNING
        id,
        organization_id as "organizationId",
        provider,
        client_id as "clientId",
        client_secret as "clientSecret",
        issuer_url as "issuerUrl",
        enabled,
        enforce_sso as "enforceSso",
        allowed_domains as "allowedDomains",
        created_at as "createdAt",
        updated_at as "updatedAt"
    `;
    const row = rows[0]!;
    return {
      ...row,
      allowedDomains: parseDomains(row.allowedDomains),
    };
  }
}
