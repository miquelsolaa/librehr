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

/** How a session was authenticated (sessions.auth_method, migration 0041). */
export type SessionAuthMethod = "password" | "sso";

/**
 * Outcome of binding a new session (AUTH-004). `ssoRequired` means every
 * active membership was skipped because its organization requires single
 * sign-on for password sessions; `breakGlass` means the session opened in
 * such an organization as an admin with TOTP enabled.
 */
export type SessionBinding =
  | (MembershipLookup & { ssoRequired: false; breakGlass: boolean })
  | { ssoRequired: true };

export interface SessionLookup {
  userId: string;
  email: string;
  name: string;
  twoFactorEnabled: boolean;
  organizationId: string;
  role: string;
  expiresAt: Date;
  authMethod: SessionAuthMethod;
  /**
   * False when the session is a password session and its organization
   * requires SSO (the user is not a break-glass admin). Computed as if
   * enforcement were active; the caller decides whether it is.
   */
  passwordAllowed: boolean;
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
   *
   * With `enforceSso` (AUTH-004, migration 0041), a password session skips
   * memberships of organizations that require single sign-on, unless the
   * user is a break-glass admin there.
   */
  async bindSessionOrganization(
    sql: Sql,
    token: string,
    options: { enforceSso?: boolean | undefined } = {},
  ): Promise<SessionBinding | null> {
    const rows = await sql<
      {
        organizationId: string | null;
        role: string | null;
        ssoRequired: boolean;
        breakGlass: boolean;
      }[]
    >`
      SELECT organization_id AS "organizationId", role,
             sso_required AS "ssoRequired", break_glass AS "breakGlass"
      FROM librehr_auth_session_bind_org(
        ${hashBearerToken(token)}, ${options.enforceSso ?? false}
      )
    `;
    const row = rows[0];
    if (!row) return null;
    if (row.ssoRequired) return { ssoRequired: true };
    if (!row.organizationId || !row.role) return null;
    return {
      organizationId: row.organizationId,
      role: row.role,
      ssoRequired: false,
      breakGlass: row.breakGlass,
    };
  }

  /**
   * AUTH-004: whether the session's user is the last break-glass admin (an
   * active admin with TOTP) of any organization that requires SSO, across
   * all their memberships (migration 0041). Keyed by the session token.
   */
  async isLastBreakGlassAdmin(sql: Sql, token: string): Promise<boolean> {
    const rows = await sql<{ last: boolean }[]>`
      SELECT librehr_auth_last_break_glass(${hashBearerToken(token)}) AS last
    `;
    return rows[0]?.last ?? false;
  }

  async session(sql: Sql, token: string): Promise<SessionLookup | null> {
    const rows = await sql<SessionLookup[]>`
      SELECT user_id AS "userId", email, name,
             two_factor_enabled AS "twoFactorEnabled",
             organization_id AS "organizationId", role,
             expires_at AS "expiresAt", auth_method AS "authMethod",
             password_allowed AS "passwordAllowed"
      FROM librehr_auth_session_v2(${hashBearerToken(token)})
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
