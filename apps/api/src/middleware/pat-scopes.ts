import type { Context, MiddlewareHandler } from "hono";
import { ForbiddenError } from "../errors/index.js";

/**
 * Personal access token scopes (ADM-006), as offered by the token settings
 * page. A token never grants more than its owner's role: scopes only narrow
 * what the role-based policies would otherwise allow.
 * - read:  GET/HEAD requests outside admin-only route groups.
 * - write: also non-GET requests outside admin-only route groups.
 * - admin: admin-only route groups (audit, webhooks, invitations, reports,
 *   employee import, DSR export, sensitive-field reveal), any method.
 *
 * Tokens authenticate without a second factor by design (they are for
 * non-interactive API clients), so credential and account-security
 * endpoints are never reachable with a token, whatever its scopes. Where
 * only some requests to an endpoint are interactive-only (an auditor
 * invitation, TIM-008), the route calls {@link requireInteractiveSession}.
 */
export const PAT_SCOPES = ["read", "write", "admin"] as const;

const INTERACTIVE_ONLY = [
  /^\/v1\/(auth|tokens|setup|sso)(\/|$)/,
  /^\/v1\/settings\/security(\/|$)/,
  // TIM-008: granting or extending auditor access is access control too.
  /^\/v1\/auditors(\/|$)/,
  /^\/v1\/org\/setup-wizard$/,
];

const ADMIN_ONLY = [
  /^\/v1\/(audit|webhooks|invitations|reports)(\/|$)/,
  /^\/v1\/employees\/import$/,
  /^\/v1\/employees\/[^/]+\/(dsr-export|reveal)$/,
];

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Normalizes stored scopes (jsonb array, or legacy JSON text) to strings. */
export function normalizePatScopes(raw: unknown): string[] {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  return Array.isArray(value)
    ? value.filter((s): s is string => typeof s === "string")
    : [];
}

/** Whether a token with these scopes may call `method path`. */
export function patScopeAllows(
  scopes: readonly string[],
  method: string,
  path: string,
): boolean {
  if (!path.startsWith("/v1/")) return true;
  if (INTERACTIVE_ONLY.some((re) => re.test(path))) return false;
  if (ADMIN_ONLY.some((re) => re.test(path))) return scopes.includes("admin");
  if (READ_METHODS.has(method.toUpperCase())) {
    return PAT_SCOPES.some((s) => scopes.includes(s));
  }
  return scopes.includes("write") || scopes.includes("admin");
}

const tokenScopeInsufficient = () =>
  new ForbiddenError({
    code: "TOKEN_SCOPE_INSUFFICIENT",
    detail: "This access token's scopes do not allow this request",
  });

/** Whether the auth middleware resolved this request from a token. */
const isTokenRequest = (c: Context): boolean =>
  Boolean((c.get as (key: string) => unknown)("patId"));

/**
 * Refuses a request authenticated with a personal access token, with the
 * same 403 as the interactive-only route groups above. For endpoints where
 * only some requests need an interactive session, decided from the body.
 *
 * @example
 * if (body.role === "auditor") requireInteractiveSession(c);
 */
export function requireInteractiveSession(c: Context): void {
  if (isTokenRequest(c)) throw tokenScopeInsufficient();
}

/**
 * Enforces token scopes for requests the auth middleware resolved from a
 * personal access token (it sets `patId` and `patScopes`). Session requests
 * pass through untouched.
 */
export const patScopeMiddleware: MiddlewareHandler = async (c, next) => {
  if (isTokenRequest(c)) {
    const scopes = normalizePatScopes(
      (c.get as (key: string) => unknown)("patScopes"),
    );
    if (!patScopeAllows(scopes, c.req.method, c.req.path)) {
      throw tokenScopeInsufficient();
    }
  }
  await next();
};
