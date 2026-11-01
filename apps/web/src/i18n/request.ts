import { getRequestConfig } from "next-intl/server";
import { locales, defaultLocale, type Locale } from "@openhr/i18n";

export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale;
  if (!locale || !locales.includes(locale as Locale)) {
    locale = defaultLocale;
  }

  const messages = (
    await import(`../../../../packages/i18n/messages/${locale}.json`)
  ).default;

  return {
    locale,
    messages,
  };
});
