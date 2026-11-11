import { trimTrailing } from "./trim-trailing.js";

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
 * Builds an OIDC authorization redirect URL for an identity provider.
 */
export function buildOidcAuthorizationUrl(params: {
  issuerUrl: string;
  clientId: string;
  redirectUri: string;
  state: string;
  scopes?: string[];
}): string {
  const cleanIssuer = trimTrailing(params.issuerUrl, "/");
  const authEndpoint = cleanIssuer.includes("accounts.google.com")
    ? "https://accounts.google.com/o/oauth2/v2/auth"
    : cleanIssuer.includes("login.microsoftonline.com")
      ? `${cleanIssuer}/oauth2/v2.0/authorize`
      : `${cleanIssuer}/protocol/openid-connect/auth`;

  const scopes = params.scopes ?? ["openid", "profile", "email"];

  const url = new URL(authEndpoint);
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("scope", scopes.join(" "));
  url.searchParams.set("state", params.state);
  url.searchParams.set("prompt", "select_account");

  return url.toString();
}

/**
 * Extracts payload claims from an unverified JWT/ID token safely for metadata reading.
 */
export function decodeJwtClaims(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2 || !parts[1]) return null;
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const jsonStr = Buffer.from(base64, "base64").toString("utf8");
    return JSON.parse(jsonStr) as Record<string, unknown>;
  } catch {
    return null;
  }
}
