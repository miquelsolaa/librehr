import crypto from "node:crypto";
import {
  createLocalJWKSet,
  errors as joseErrors,
  jwtVerify,
  type JWTPayload,
} from "jose";
import type { JsonWebKeySet, OidcProviderMetadata } from "./discovery.js";
import { OidcError } from "./errors.js";
import { isAllowedEmailDomain } from "./oidc.js";

/** Asymmetric algorithms only: never `none` and never HS* (shared secret). */
export const ID_TOKEN_ALGORITHMS = ["RS256", "PS256", "ES256"];
const CLOCK_TOLERANCE_SECONDS = 60;
const GOOGLE_ISSUER = "https://accounts.google.com";

export interface IdTokenExpectations {
  provider: Pick<OidcProviderMetadata, "issuer" | "microsoftTenantId">;
  clientId: string;
  /** The nonce stored with the login request. */
  nonce: string;
  allowedDomains: string[];
  /** Test clock; defaults to now. */
  currentDate?: Date | undefined;
}

/** The identity the callback links and matches; never logged. */
export interface VerifiedIdentity {
  issuer: string;
  subject: string;
  email: string;
}

/** Loads the provider's key set; `refresh` asks for a refetch (key rotation). */
export type KeySetLoader = (refresh: boolean) => Promise<JsonWebKeySet>;

/**
 * Verifies an id_token (AUTH-004): signature against the provider's JWKS,
 * `iss`, `aud`, `exp`/`iat`, the stored nonce, `azp`, then the email rules.
 * An unknown `kid` triggers one key set refetch before failing.
 */
export async function verifyIdToken(
  idToken: string,
  expected: IdTokenExpectations,
  loadKeys: KeySetLoader,
): Promise<VerifiedIdentity> {
  const payload = await verifySignedClaims(idToken, expected, loadKeys);

  if (
    typeof payload.sub !== "string" ||
    payload.sub.length === 0 ||
    typeof payload["nonce"] !== "string" ||
    !safeEqual(payload["nonce"], expected.nonce)
  ) {
    throw new OidcError("token_invalid");
  }
  // OIDC Core 3.1.3.7: with several audiences, azp must name this client.
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  const azp = payload["azp"];
  if (
    (audiences.length > 1 || azp !== undefined) &&
    azp !== expected.clientId
  ) {
    throw new OidcError("token_invalid");
  }

  const email = verifiedEmail(payload, expected);
  if (!isAllowedEmailDomain(email, expected.allowedDomains)) {
    throw new OidcError("domain_not_allowed");
  }
  return {
    issuer: expected.provider.issuer,
    subject: payload.sub,
    email: email.toLowerCase(),
  };
}

async function verifySignedClaims(
  idToken: string,
  expected: IdTokenExpectations,
  loadKeys: KeySetLoader,
): Promise<JWTPayload> {
  const options = {
    issuer: expected.provider.issuer,
    audience: expected.clientId,
    algorithms: ID_TOKEN_ALGORITHMS,
    clockTolerance: CLOCK_TOLERANCE_SECONDS,
    requiredClaims: ["exp", "iat", "sub"],
    ...(expected.currentDate ? { currentDate: expected.currentDate } : {}),
  };
  const attempt = async (refresh: boolean) =>
    (
      await jwtVerify(
        idToken,
        createLocalJWKSet(await loadKeys(refresh)),
        options,
      )
    ).payload;
  try {
    try {
      return await attempt(false);
    } catch (error) {
      if (!(error instanceof joseErrors.JWKSNoMatchingKey)) throw error;
      return await attempt(true);
    }
  } catch (error) {
    if (error instanceof OidcError) throw error;
    throw new OidcError("token_invalid");
  }
}

/**
 * The email the callback may match on. Generic and Google providers must
 * say `email_verified: true`; Google's `hd` must also be an allowed domain.
 * Microsoft tokens rarely carry `email_verified`, so a Microsoft issuer is
 * tenant-specific (see assertSupportedIssuer) and `tid` must equal it.
 */
function verifiedEmail(
  payload: JWTPayload,
  expected: IdTokenExpectations,
): string {
  const { microsoftTenantId } = expected.provider;
  if (payload["email_verified"] === false) {
    throw new OidcError("email_not_verified");
  }
  if (microsoftTenantId !== null) {
    const tid = payload["tid"];
    if (typeof tid !== "string" || tid.toLowerCase() !== microsoftTenantId) {
      throw new OidcError("token_invalid");
    }
    const email = payload["email"] ?? payload["preferred_username"];
    if (typeof email !== "string" || !email.includes("@")) {
      throw new OidcError("email_not_verified");
    }
    return email;
  }
  const email = payload["email"];
  if (typeof email !== "string" || payload["email_verified"] !== true) {
    throw new OidcError("email_not_verified");
  }
  const hd = payload["hd"];
  if (
    expected.provider.issuer === GOOGLE_ISSUER &&
    hd !== undefined &&
    (typeof hd !== "string" ||
      !isAllowedEmailDomain(`x@${hd}`, expected.allowedDomains))
  ) {
    throw new OidcError("domain_not_allowed");
  }
  return email;
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
