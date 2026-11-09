import type { Sql } from "postgres";

/**
 * Identity lookups that run before a tenant context exists. They go through
 * the SECURITY DEFINER functions of migration 0019, the only way the runtime
 * role (NOBYPASSRLS) can read these tenant tables without `withTenant`.
 */

export interface MembershipLookup {
  organizationId: string;
  role: string;
}

export interface SessionLookup {
  userId: string;
  email: string;
  name: string;
  twoFactorEnabled: boolean;
  organizationId: string;
  role: string;
  expiresAt: Date;
}

export interface PersonalAccessTokenLookup {
  id: string;
  organizationId: string;
  userId: string;
  scopes: string[];
  email: string;
  userName: string;
  role: string;
}

export interface InvitationLookup {
  id: string;
  organizationId: string;
  organizationName: string;
  email: string;
  role: string;
  expiresAt: Date;
  acceptedAt: Date | null;
}

export interface SsoConfigLookup {
  id: string;
  organizationId: string;
  provider: string;
  clientId: string;
  issuerUrl: string;
  allowedDomains: string[];
}

// jsonb arrays written by older code may hold a JSON-encoded string.
function stringArray(value: unknown): string[] {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return [];
    }
  }
  return Array.isArray(parsed)
    ? parsed.filter((v): v is string => typeof v === "string")
    : [];
}

export class IdentityRepository {
  /**
   * The user's membership in `organizationId`, or the default one (oldest by
   * created_at, then id) when no organization is given.
   */
  async membership(
    sql: Sql,
    userId: string,
    organizationId: string | null = null,
  ): Promise<MembershipLookup | null> {
    const rows = await sql<MembershipLookup[]>`
      SELECT organization_id AS "organizationId", role
      FROM librehr_auth_membership(${userId}::uuid, ${organizationId}::uuid)
    `;
    return rows[0] ?? null;
  }

  async session(sql: Sql, token: string): Promise<SessionLookup | null> {
    const rows = await sql<SessionLookup[]>`
      SELECT user_id AS "userId", email, name,
             two_factor_enabled AS "twoFactorEnabled",
             organization_id AS "organizationId", role,
             expires_at AS "expiresAt"
      FROM librehr_auth_session(${token})
    `;
    return rows[0] ?? null;
  }

  async personalAccessToken(
    sql: Sql,
    tokenHash: string,
  ): Promise<PersonalAccessTokenLookup | null> {
    const rows = await sql<(PersonalAccessTokenLookup & { scopes: unknown })[]>`
      SELECT id, organization_id AS "organizationId", user_id AS "userId",
             scopes, email, user_name AS "userName", role
      FROM librehr_auth_personal_access_token(${tokenHash})
    `;
    const row = rows[0];
    return row ? { ...row, scopes: stringArray(row.scopes) } : null;
  }

  async invitation(sql: Sql, token: string): Promise<InvitationLookup | null> {
    const rows = await sql<InvitationLookup[]>`
      SELECT id, organization_id AS "organizationId",
             organization_name AS "organizationName", email, role,
             expires_at AS "expiresAt", accepted_at AS "acceptedAt"
      FROM librehr_auth_invitation(${token})
    `;
    return rows[0] ?? null;
  }

  async ssoConfigForDomain(
    sql: Sql,
    domain: string,
  ): Promise<SsoConfigLookup | null> {
    const rows = await sql<(SsoConfigLookup & { allowedDomains: unknown })[]>`
      SELECT id, organization_id AS "organizationId", provider,
             client_id AS "clientId", issuer_url AS "issuerUrl",
             allowed_domains AS "allowedDomains"
      FROM librehr_auth_sso_config(${domain})
    `;
    const row = rows[0];
    return row
      ? { ...row, allowedDomains: stringArray(row.allowedDomains) }
      : null;
  }
}
