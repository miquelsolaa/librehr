import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { SSO_LOGIN_REQUEST_TTL_SECONDS, type SsoLocale } from "@librehr/db";

/**
 * Binds a started SSO sign-in to the browser that started it (AUTH-004).
 * The callback refuses a `state` this browser did not receive, so an
 * attacker cannot finish their own sign-in in someone else's browser
 * (login CSRF). Scoped to the callback path.
 */
export const SSO_STATE_COOKIE = "librehr_sso_state";

/**
 * The language the sign-in started in, so refusals that happen before the
 * stored request is found (a lost or mismatched state) still answer in it.
 * Not secret; kept a day so a person who comes back late is not switched to
 * the default language.
 */
export const SSO_LOCALE_COOKIE = "librehr_sso_locale";

/**
 * The state cookie outlives the stored request by two minutes, so a slow
 * sign-in reaches the request and reports SSO_EXPIRED instead of a lost
 * state.
 */
const STATE_COOKIE_MAX_AGE = SSO_LOGIN_REQUEST_TTL_SECONDS + 120;
const LOCALE_COOKIE_MAX_AGE = 24 * 60 * 60;

const LOCALES: readonly SsoLocale[] = ["ca", "es", "en"];

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
  locale: SsoLocale,
  redirectUri: string,
): void {
  const options = cookieOptions(redirectUri);
  setCookie(c, SSO_STATE_COOKIE, state, {
    ...options,
    maxAge: STATE_COOKIE_MAX_AGE,
  });
  setCookie(c, SSO_LOCALE_COOKIE, locale, {
    ...options,
    maxAge: LOCALE_COOKIE_MAX_AGE,
  });
}

/**
 * Reads the state and always clears it: each state is tried once. The
 * locale cookie stays (another tab may still need it); an unknown value
 * falls back to Catalan, the default locale.
 */
export function takeStateCookie(
  c: Context,
  redirectUri: string,
): { state: string | undefined; locale: SsoLocale } {
  const state = getCookie(c, SSO_STATE_COOKIE);
  deleteCookie(c, SSO_STATE_COOKIE, cookieOptions(redirectUri));
  const raw = getCookie(c, SSO_LOCALE_COOKIE);
  const locale = LOCALES.find((l) => l === raw) ?? "ca";
  return { state, locale };
}
