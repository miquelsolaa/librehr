import type { Sql } from "postgres";
import { hashBearerToken } from "../crypto/token-hash.js";
import { jsonStringArray } from "./json-array.js";
import { decryptStoredClientSecret } from "./sso.repository.js";

/**
 * SSO sign-in requests (AUTH-004, migration 0044): started before a tenant
 * context exists, through the SECURITY DEFINER functions of migration 0044.
 * `IdentityRepository` exposes these as methods.
 */

export type SsoLocale = "ca" | "es" | "en";

/** A started SSO sign-in (AUTH-004), stored until the callback. */
export interface SsoLoginRequestInput {
  /** Raw `state` sent to the identity provider; only its hash is stored. */
  state: string;
  organizationId: string;
  ssoConfigurationId: string;
  /** Snapshot of the configuration; the callback refuses a changed one. */
  issuerUrl: string;
  clientId: string;
  nonce: string;
  codeVerifier: string;
  locale: SsoLocale;
}

/** How long a started sign-in can be completed (migration 0044). */
export const SSO_LOGIN_REQUEST_TTL_SECONDS = 600;

export type SsoConsumeResult =
  | {
      outcome: "ok";
      organizationId: string;
      ssoConfigurationId: string;
      provider: string;
      issuerUrl: string;
      clientId: string;
      /** Decrypted in memory for the token exchange; never log it. */
      clientSecret: string;
      allowedDomains: string[];
      nonce: string;
      codeVerifier: string;
      locale: SsoLocale;
    }
  | {
      outcome: "expired" | "unavailable";
      organizationId: string;
      locale: SsoLocale;
    }
  | { outcome: "invalid" };

export type SsoResolveOutcome =
  | "ok"
  | "expired"
  | "invalid"
  | "unavailable"
  | "domain_not_allowed"
  | "no_account"
  | "identity_conflict"
  | "multi_org_account";

export type SsoResolveResult =
  | { outcome: "ok"; userId: string; organizationId: string }
  | {
      outcome: Exclude<SsoResolveOutcome, "ok">;
      organizationId: string | null;
    };

const SSO_LOCALES: readonly string[] = ["ca", "es", "en"];

function ssoLocale(value: string | null): SsoLocale {
  return value !== null && SSO_LOCALES.includes(value)
    ? (value as SsoLocale)
    : "ca";
}

/**
 * Stores a started SSO sign-in (AUTH-004), valid for
 * SSO_LOGIN_REQUEST_TTL_SECONDS. Also purges requests older than one day
 * (retention, migration 0044).
 */
export async function ssoBeginLogin(
  sql: Sql,
  input: SsoLoginRequestInput,
): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`
      DELETE FROM sso_login_requests
      WHERE created_at < now() - interval '1 day'`;
    await tx`
      INSERT INTO sso_login_requests (
        state_hash, organization_id, sso_configuration_id, issuer_url,
        client_id, nonce, code_verifier, locale, expires_at
      ) VALUES (
        ${hashBearerToken(input.state)}, ${input.organizationId},
        ${input.ssoConfigurationId}, ${input.issuerUrl}, ${input.clientId},
        ${input.nonce}, ${input.codeVerifier}, ${input.locale},
        now() + make_interval(secs => ${SSO_LOGIN_REQUEST_TTL_SECONDS})
      )`;
  });
}

/**
 * Spends the sign-in request for `state` (once) and returns what the token
 * exchange needs, with the client secret decrypted. See
 * librehr_auth_sso_consume (0044) for the outcomes.
 */
export async function ssoConsume(
  sql: Sql,
  state: string,
): Promise<SsoConsumeResult> {
  const rows = await sql<
    {
      outcome: string;
      organizationId: string | null;
      ssoConfigurationId: string | null;
      provider: string | null;
      issuerUrl: string | null;
      clientId: string | null;
      clientSecret: string | null;
      allowedDomains: unknown;
      nonce: string | null;
      codeVerifier: string | null;
      locale: string | null;
    }[]
  >`
    SELECT outcome, organization_id AS "organizationId",
           sso_configuration_id AS "ssoConfigurationId", provider,
           issuer_url AS "issuerUrl", client_id AS "clientId",
           client_secret AS "clientSecret",
           allowed_domains AS "allowedDomains", nonce,
           code_verifier AS "codeVerifier", locale
    FROM librehr_auth_sso_consume(${hashBearerToken(state)})
  `;
  const row = rows[0];
  if (!row || row.organizationId === null) return { outcome: "invalid" };
  if (row.outcome === "expired" || row.outcome === "unavailable") {
    return {
      outcome: row.outcome,
      organizationId: row.organizationId,
      locale: ssoLocale(row.locale),
    };
  }
  if (
    row.outcome !== "ok" ||
    row.ssoConfigurationId === null ||
    row.provider === null ||
    row.issuerUrl === null ||
    row.clientId === null ||
    row.clientSecret === null ||
    row.nonce === null ||
    row.codeVerifier === null
  ) {
    return { outcome: "invalid" };
  }
  return {
    outcome: "ok",
    organizationId: row.organizationId,
    ssoConfigurationId: row.ssoConfigurationId,
    provider: row.provider,
    issuerUrl: row.issuerUrl,
    clientId: row.clientId,
    clientSecret: decryptStoredClientSecret(row.clientSecret),
    allowedDomains: jsonStringArray(row.allowedDomains),
    nonce: row.nonce,
    codeVerifier: row.codeVerifier,
    locale: ssoLocale(row.locale),
  };
}

/**
 * Maps an identity whose id_token the caller has verified to a member of
 * the request's organization, linking (issuer, subject) on first sign-in.
 * Call once, after `ssoConsume`. See librehr_auth_sso_resolve_user (0044).
 */
export async function ssoResolveUser(
  sql: Sql,
  input: { state: string; issuer: string; subject: string; email: string },
): Promise<SsoResolveResult> {
  const rows = await sql<
    {
      outcome: SsoResolveOutcome;
      userId: string | null;
      organizationId: string | null;
    }[]
  >`
    SELECT outcome, user_id AS "userId", organization_id AS "organizationId"
    FROM librehr_auth_sso_resolve_user(
      ${hashBearerToken(input.state)}, ${input.issuer}, ${input.subject},
      ${input.email}
    )
  `;
  const row = rows[0];
  if (!row) return { outcome: "expired", organizationId: null };
  if (row.outcome === "ok") {
    if (row.userId === null || row.organizationId === null) {
      return { outcome: "invalid", organizationId: null };
    }
    return {
      outcome: "ok",
      userId: row.userId,
      organizationId: row.organizationId,
    };
  }
  return { outcome: row.outcome, organizationId: row.organizationId };
}
