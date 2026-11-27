import crypto from "node:crypto";
import { z } from "zod";
import type { OidcHttp, OidcProviderMetadata } from "./discovery.js";
import { OidcError } from "./errors.js";

/**
 * Validates whether an email domain is in the organization's allowed SSO domains.
 */
export function isAllowedEmailDomain(
  email: string,
  allowedDomains: string[],
): boolean {
  if (!email || !allowedDomains || allowedDomains.length === 0) {
    return false;
  }
  const parts = email.toLowerCase().split("@");
  if (parts.length !== 2 || !parts[1]) {
    return false;
  }
  const domain = parts[1].trim();

  return allowedDomains.some((allowed) => {
    const clean = allowed.trim().toLowerCase().replace(/^@/, "");
    return clean === domain;
  });
}

/**
 * Builds the authorization-code request (with PKCE and nonce) for the
 * provider's discovered authorization endpoint.
 */
export function buildOidcAuthorizationUrl(params: {
  /** From the provider's discovery document (see discovery.ts). */
  authorizationEndpoint: string;
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  /** S256 PKCE challenge (see createLoginSecrets). */
  codeChallenge: string;
  scopes?: string[];
}): string {
  const scopes = params.scopes ?? ["openid", "profile", "email"];

  const url = new URL(params.authorizationEndpoint);
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("scope", scopes.join(" "));
  url.searchParams.set("state", params.state);
  url.searchParams.set("prompt", "select_account");
  url.searchParams.set("nonce", params.nonce);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");

  return url.toString();
}

/** 32 random bytes, base64url: 43 characters from the RFC 7636 alphabet. */
export function randomUrlToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/**
 * RFC 7636 S256 code challenge: BASE64URL(SHA256(ASCII(code_verifier))).
 *
 * @example pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")
 * // "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
 */
export function pkceChallenge(codeVerifier: string): string {
  return crypto.createHash("sha256").update(codeVerifier).digest("base64url");
}

/** Per-login secrets: state and nonce bind the flow, the verifier is PKCE. */
export interface LoginSecrets {
  state: string;
  nonce: string;
  codeVerifier: string;
  codeChallenge: string;
}

export function createLoginSecrets(): LoginSecrets {
  const codeVerifier = randomUrlToken();
  return {
    state: randomUrlToken(),
    nonce: randomUrlToken(),
    codeVerifier,
    codeChallenge: pkceChallenge(codeVerifier),
  };
}

const TokenResponseSchema = z.object({
  id_token: z.string().min(1),
  token_type: z.string().optional(),
});

/** RFC 6749 2.3.1: id and secret are form-encoded before base64. */
function basicAuth(clientId: string, clientSecret: string): string {
  const encode = (value: string) =>
    new URLSearchParams({ v: value }).toString().slice(2);
  const raw = `${encode(clientId)}:${encode(clientSecret)}`;
  return `Basic ${Buffer.from(raw).toString("base64")}`;
}

/**
 * Exchanges an authorization code for the id_token (authorization-code flow
 * with PKCE). Any transport failure, non-200 answer or response without an
 * id_token is `exchange_failed`; the provider's error text is not kept.
 */
export async function exchangeAuthorizationCode(
  http: OidcHttp,
  params: {
    provider: Pick<OidcProviderMetadata, "tokenEndpoint" | "tokenAuthMethod">;
    clientId: string;
    clientSecret: string;
    code: string;
    redirectUri: string;
    codeVerifier: string;
  },
): Promise<string> {
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: params.redirectUri,
    code_verifier: params.codeVerifier,
  });
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (params.provider.tokenAuthMethod === "client_secret_post") {
    form.set("client_id", params.clientId);
    form.set("client_secret", params.clientSecret);
  } else {
    headers["Authorization"] = basicAuth(params.clientId, params.clientSecret);
  }
  let response: Awaited<ReturnType<OidcHttp>>;
  try {
    response = await http({
      method: "POST",
      url: params.provider.tokenEndpoint,
      headers,
      body: form.toString(),
    });
  } catch {
    throw new OidcError("exchange_failed");
  }
  const parsed = TokenResponseSchema.safeParse(response.json);
  if (response.status !== 200 || !parsed.success) {
    throw new OidcError("exchange_failed");
  }
  return parsed.data.id_token;
}
