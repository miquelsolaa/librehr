import type { TenantTx } from "../with-tenant.js";
import { decryptEnvelope, encryptEnvelope } from "../crypto/envelope.js";
import { jsonStringArray } from "./json-array.js";

/**
 * An SSO configuration as read for display or discovery. The client secret
 * is never part of it; use `getClientSecret` where the OIDC exchange needs
 * it.
 */
export interface SsoConfigRow {
  id: string;
  organizationId: string;
  provider: string;
  clientId: string;
  issuerUrl: string;
  enabled: boolean;
  enforceSso: boolean;
  allowedDomains: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface SaveSsoConfigInput {
  provider: string;
  clientId: string;
  /** Omitted to keep the stored secret (the UI never reads it back). */
  clientSecret?: string | undefined;
  issuerUrl: string;
  enabled: boolean;
  enforceSso: boolean;
  allowedDomains: string[];
}

/**
 * Thrown when a configuration is saved without a client secret and there is
 * no stored secret for the same provider, client id and issuer.
 */
export class SsoClientSecretRequiredError extends Error {
  constructor() {
    super(
      "A client secret is required for a new SSO configuration or a changed provider, client or issuer",
    );
    this.name = "SsoClientSecretRequiredError";
  }
}

// client_secret holds an envelope (encryptEnvelope's JSON). Rows written
// before encryption hold the plaintext; they are re-encrypted on the next
// save, and `getClientSecret` still reads them meanwhile.
function isEnvelope(value: string): boolean {
  if (!value.startsWith("{")) return false;
  try {
    const parsed: unknown = JSON.parse(value);
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      "keyId" in parsed &&
      "encryptedDek" in parsed &&
      "ciphertext" in parsed
    );
  } catch {
    return false;
  }
}

const COLUMNS = `
  id,
  organization_id as "organizationId",
  provider,
  client_id as "clientId",
  issuer_url as "issuerUrl",
  enabled,
  enforce_sso as "enforceSso",
  allowed_domains as "allowedDomains",
  created_at as "createdAt",
  updated_at as "updatedAt"
`;

function toRow(row: SsoConfigRow): SsoConfigRow {
  return { ...row, allowedDomains: jsonStringArray(row.allowedDomains) };
}

export class SsoRepository {
  async getConfig(tx: TenantTx): Promise<SsoConfigRow | null> {
    const rows = await tx.unsafe<SsoConfigRow[]>(
      `SELECT ${COLUMNS} FROM sso_configurations LIMIT 1`,
    );
    const row = rows[0];
    return row ? toRow(row) : null;
  }

  /** The decrypted client secret, for the OIDC token exchange only. */
  async getClientSecret(tx: TenantTx): Promise<string | null> {
    const rows = await tx<{ clientSecret: string }[]>`
      SELECT client_secret AS "clientSecret" FROM sso_configurations LIMIT 1
    `;
    const stored = rows[0]?.clientSecret;
    if (stored === undefined) return null;
    return isEnvelope(stored) ? decryptEnvelope(stored) : stored;
  }

  async saveConfig(
    tx: TenantTx,
    data: SaveSsoConfigInput,
  ): Promise<SsoConfigRow> {
    const existing = await tx<
      {
        id: string;
        clientSecret: string;
        provider: string;
        clientId: string;
        issuerUrl: string;
      }[]
    >`
      SELECT id, client_secret AS "clientSecret", provider,
             client_id AS "clientId", issuer_url AS "issuerUrl"
      FROM sso_configurations LIMIT 1
    `;
    const current = existing[0];
    // The stored secret belongs to one client at one identity provider; it is
    // never carried over to another (it would be sent to the new issuer).
    const sameClient =
      current !== undefined &&
      current.provider === data.provider &&
      current.clientId === data.clientId &&
      current.issuerUrl === data.issuerUrl;

    let encryptedSecret: string;
    if (data.clientSecret !== undefined) {
      encryptedSecret = encryptEnvelope(data.clientSecret);
    } else if (current && sameClient) {
      encryptedSecret = isEnvelope(current.clientSecret)
        ? current.clientSecret
        : encryptEnvelope(current.clientSecret);
    } else {
      throw new SsoClientSecretRequiredError();
    }

    if (current) {
      const rows = await tx<SsoConfigRow[]>`
        UPDATE sso_configurations
        SET
          provider = ${data.provider},
          client_id = ${data.clientId},
          client_secret = ${encryptedSecret},
          issuer_url = ${data.issuerUrl},
          enabled = ${data.enabled},
          enforce_sso = ${data.enforceSso},
          allowed_domains = ${tx.json(data.allowedDomains)},
          updated_at = now()
        WHERE id = ${current.id}
        RETURNING ${tx.unsafe(COLUMNS)}
      `;
      return toRow(rows[0]!);
    }

    const rows = await tx<SsoConfigRow[]>`
      INSERT INTO sso_configurations (
        provider, client_id, client_secret, issuer_url,
        enabled, enforce_sso, allowed_domains
      ) VALUES (
        ${data.provider},
        ${data.clientId},
        ${encryptedSecret},
        ${data.issuerUrl},
        ${data.enabled},
        ${data.enforceSso},
        ${tx.json(data.allowedDomains)}
      )
      RETURNING ${tx.unsafe(COLUMNS)}
    `;
    return toRow(rows[0]!);
  }
}
