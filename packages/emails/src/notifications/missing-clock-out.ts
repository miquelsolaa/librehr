import { createRequire } from "node:module";
import { defaultLocale, locales, type Locale } from "@librehr/i18n";

/**
 * In-app notification copy rendered by the worker. The strings live in the
 * `@librehr/i18n` catalogs (so `pnpm i18n:check` covers every locale); this
 * package exposes them because the worker may import `emails` but not `i18n`
 * (dependency rule: worker -> core, db, emails).
 *
 * Catalogs are loaded with `require` (JSON) on first use, which caches them;
 * the entries read are checked to be strings, so a broken catalog fails
 * loudly instead of storing "undefined" in someone's inbox.
 */
const requireJson = createRequire(import.meta.url);

function catalog(locale: Locale): unknown {
  return requireJson(`@librehr/i18n/messages/${locale}.json`) as unknown;
}

function message(locale: Locale, key: string): string {
  let node: unknown = catalog(locale);
  for (const part of key.split(".")) {
    node =
      node !== null && typeof node === "object"
        ? (node as Record<string, unknown>)[part]
        : undefined;
  }
  if (typeof node !== "string") {
    throw new Error(`Missing i18n message ${key} for locale ${locale}`);
  }
  return node;
}

/** The supported locale for `locale`, else the default (ca). */
export function notificationLocale(locale: string | null | undefined): Locale {
  return locales.find((l) => l === locale) ?? defaultLocale;
}

export interface NotificationText {
  title: string;
  body: string;
}

/**
 * TIM-003: the "missing clock-out" reminder in `locale` (falls back to ca).
 * `date` is the ISO calendar date of the day left open.
 *
 * @example
 * missingClockOutNotification("en", "2026-11-02").title; // => "Missing clock-out"
 */
export function missingClockOutNotification(
  locale: string | null | undefined,
  date: string,
): NotificationText {
  const loc = notificationLocale(locale);
  // Plain substitution, not ICU: these entries must stay free of ICU syntax
  // (plural/select, '' escapes), which the tests check for every locale.
  return {
    title: message(loc, "notifications.missingClockOut.title"),
    body: message(loc, "notifications.missingClockOut.body").replace(
      "{date}",
      date,
    ),
  };
}
