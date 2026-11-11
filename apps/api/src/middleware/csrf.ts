import type { MiddlewareHandler } from "hono";
import { ForbiddenError } from "../errors/index.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export interface CsrfOptions {
  /** Public web origin (APP_URL); requests from it are trusted. */
  appUrl?: string | undefined;
  /**
   * Cross-origin web clients allowed to use the cookie (CORS_ORIGINS); the
   * same list CORS allows, so the two layers agree.
   */
  allowedOrigins?: readonly string[] | undefined;
  /**
   * In development and test, any http://localhost:* / 127.0.0.1:* origin is
   * trusted. Unset is treated as production (fails closed).
   */
  nodeEnv?: "development" | "test" | "production" | undefined;
}

function originOf(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * CSRF defence for cookie-authenticated (and anonymous) browser requests.
 *
 * The session cookie is SameSite=Lax, which already keeps it off cross-site
 * POSTs in current browsers. This middleware is the second layer: a
 * state-changing request is refused when the browser reports it as
 * cross-site, through Sec-Fetch-Site or an Origin that is neither the API's
 * own nor the web app's. Requests that carry an Authorization header are
 * exempt: browsers never attach one on their own, so they cannot be forged
 * cross-site (and a cross-origin script would first need a CORS preflight).
 * Requests with neither header come from non-browser clients and pass.
 *
 * It needs no custom request header, so it does not depend on the CORS
 * allow-list.
 */
export function createCsrfMiddleware(
  options: CsrfOptions = {},
): MiddlewareHandler {
  const trustedOrigins = new Set(
    [options.appUrl, ...(options.allowedOrigins ?? [])]
      .map((value) => (value ? originOf(value) : null))
      .filter((value): value is string => value !== null),
  );
  const allowLocalhost =
    options.nodeEnv === "development" || options.nodeEnv === "test";

  const trusted = (origin: string, host: string | undefined): boolean => {
    const parsed = originOf(origin);
    if (!parsed) return false;
    if (trustedOrigins.has(parsed)) return true;
    const url = new URL(parsed);
    if (host && url.host === host) return true;
    return (
      allowLocalhost &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1")
    );
  };

  return async (c, next) => {
    if (SAFE_METHODS.has(c.req.method)) return next();
    if (c.req.header("authorization")) return next();

    const fetchSite = c.req.header("sec-fetch-site");
    if (fetchSite === "same-origin" || fetchSite === "none") return next();

    const origin = c.req.header("origin");
    if (origin && origin !== "null") {
      if (trusted(origin, c.req.header("host"))) return next();
      throw new ForbiddenError({
        code: "CSRF_REJECTED",
        detail: "Cross-site request refused",
      });
    }

    if (
      origin === "null" ||
      fetchSite === "cross-site" ||
      fetchSite === "same-site"
    ) {
      throw new ForbiddenError({
        code: "CSRF_REJECTED",
        detail: "Cross-site request refused",
      });
    }

    return next();
  };
}
