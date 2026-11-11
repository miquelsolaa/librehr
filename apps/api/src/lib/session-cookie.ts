import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

/**
 * AUTH-001/002: browser sessions live only in this httpOnly cookie. The token
 * is never returned in a response body, so script running in the page (XSS)
 * cannot read it.
 */
export const SESSION_COOKIE = "librehr_session";

export interface SessionCookieOptions {
  /** NODE_ENV from the validated env; production always sets Secure. */
  nodeEnv?: "development" | "test" | "production" | undefined;
  /** Trusted proxy hops; X-Forwarded-Proto is only honoured when > 0. */
  trustProxy?: number | undefined;
}

function isSecureRequest(c: Context, options: SessionCookieOptions): boolean {
  if (options.nodeEnv === "production") return true;
  if (new URL(c.req.url).protocol === "https:") return true;
  if ((options.trustProxy ?? 0) > 0) {
    const proto = c.req.header("x-forwarded-proto")?.split(",")[0]?.trim();
    return proto === "https";
  }
  return false;
}

export function setSessionCookie(
  c: Context,
  token: string,
  expiresAt: Date,
  options: SessionCookieOptions,
): void {
  const maxAge = Math.max(
    0,
    Math.floor((expiresAt.getTime() - Date.now()) / 1000),
  );
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    secure: isSecureRequest(c, options),
    path: "/",
    maxAge,
  });
}

export function clearSessionCookie(
  c: Context,
  options: SessionCookieOptions,
): void {
  deleteCookie(c, SESSION_COOKIE, {
    httpOnly: true,
    sameSite: "Lax",
    secure: isSecureRequest(c, options),
    path: "/",
  });
}

export function readSessionCookie(c: Context): string | undefined {
  const value = getCookie(c, SESSION_COOKIE);
  return value && value.length > 0 ? value : undefined;
}
