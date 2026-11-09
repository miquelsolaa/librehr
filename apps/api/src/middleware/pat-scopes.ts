import type { MiddlewareHandler } from "hono";
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
 * endpoints are never reachable with a token, whatever its scopes.
 */
export const PAT_SCOPES = ["read", "write", "admin"] as const;

const INTERACTIVE_ONLY = [
  /^\/v1\/(auth|tokens|setup|sso)(\/|$)/,
  /^\/v1\/settings\/security(\/|$)/,
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

/**
 * Enforces token scopes for requests the auth middleware resolved from a
 * personal access token (it sets `patId` and `patScopes`). Session requests
 * pass through untouched.
 */
export const patScopeMiddleware: MiddlewareHandler = async (c, next) => {
  const get = c.get as (key: string) => unknown;
  if (get("patId")) {
    const scopes = normalizePatScopes(get("patScopes"));
    if (!patScopeAllows(scopes, c.req.method, c.req.path)) {
      throw new ForbiddenError({
        code: "TOKEN_SCOPE_INSUFFICIENT",
        detail: "This access token's scopes do not allow this request",
      });
    }
  }
  await next();
};
