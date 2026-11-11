import type { Sql } from "postgres";
import { jsonStringArray } from "./json-array.js";
import { hashBearerToken } from "../crypto/token-hash.js";

/**
 * Identity lookups that run before a tenant context exists. They go through
 * the SECURITY DEFINER functions of migrations 0019/0020, the only way the runtime
 * role (NOBYPASSRLS) can read these tenant tables without `withTenant`.
 *
 * Callers pass raw session and invitation tokens; only their SHA-256 digest
 * (`hashBearerToken`) is stored, so each lookup hashes before querying.
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

const stringArray = jsonStringArray;

/**
 * Personal access token scopes, mirroring PAT_SCOPES in
 * @librehr/contracts/tokens (the db package does not depend on contracts;
 * the api test `stored-arrays.test.ts` asserts the two lists match).
 * Unknown stored values are dropped so the auth path only ever sees scopes
 * the policy knows: a dropped scope grants less, never more.
 */
export const KNOWN_PAT_SCOPES = ["read", "write", "admin"] as const;

function patScopes(value: unknown): string[] {
  const known: readonly string[] = KNOWN_PAT_SCOPES;
  return [...new Set(stringArray(value).filter((s) => known.includes(s)))];
}

export class IdentityRepository {
  /**
   * Binds a freshly created session to the organization it opens in: the one
   * already stored on it or, when none is, the user's default membership
   * (oldest by created_at, then id). Keyed by the session token, never by a
   * bare user id (migration 0020). Returns null when the session is unknown or
   * expired, or the user has no active membership there.
   */
  async bindSessionOrganization(
    sql: Sql,
    token: string,
  ): Promise<MembershipLookup | null> {
    const rows = await sql<MembershipLookup[]>`
      SELECT organization_id AS "organizationId", role
      FROM librehr_auth_session_bind_org(${hashBearerToken(token)})
    `;
    return rows[0] ?? null;
  }

  async session(sql: Sql, token: string): Promise<SessionLookup | null> {
    const rows = await sql<SessionLookup[]>`
      SELECT user_id AS "userId", email, name,
             two_factor_enabled AS "twoFactorEnabled",
             organization_id AS "organizationId", role,
             expires_at AS "expiresAt"
      FROM librehr_auth_session(${hashBearerToken(token)})
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
    return row ? { ...row, scopes: patScopes(row.scopes) } : null;
  }

  async invitation(sql: Sql, token: string): Promise<InvitationLookup | null> {
    const rows = await sql<InvitationLookup[]>`
      SELECT id, organization_id AS "organizationId",
             organization_name AS "organizationName", email, role,
             expires_at AS "expiresAt", accepted_at AS "acceptedAt"
      FROM librehr_auth_invitation(${hashBearerToken(token)})
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
