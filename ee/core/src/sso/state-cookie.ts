import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { SSO_LOGIN_REQUEST_TTL_SECONDS } from "@librehr/db";

/**
 * Binds a started SSO sign-in to the browser that started it (AUTH-004).
 * The callback refuses a `state` this browser did not receive, so an
 * attacker cannot finish their own sign-in in someone else's browser
 * (login CSRF). Scoped to the callback path and as long-lived as the
 * stored request.
 */
export const SSO_STATE_COOKIE = "librehr_sso_state";

function cookieOptions(redirectUri: string) {
  const url = new URL(redirectUri);
  return {
    httpOnly: true,
    // Lax: the provider's redirect back is a top-level GET navigation.
    sameSite: "Lax" as const,
    secure: url.protocol === "https:",
    path: url.pathname,
  };
}

export function setStateCookie(
  c: Context,
  state: string,
  redirectUri: string,
): void {
  setCookie(c, SSO_STATE_COOKIE, state, {
    ...cookieOptions(redirectUri),
    maxAge: SSO_LOGIN_REQUEST_TTL_SECONDS,
  });
}

/** Reads the cookie and always clears it: each state is tried once. */
export function takeStateCookie(
  c: Context,
  redirectUri: string,
): string | undefined {
  const value = getCookie(c, SSO_STATE_COOKIE);
  deleteCookie(c, SSO_STATE_COOKIE, cookieOptions(redirectUri));
  return value;
}
