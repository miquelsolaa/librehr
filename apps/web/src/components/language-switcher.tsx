"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { locales, type Locale } from "@librehr/i18n";
import { Globe } from "lucide-react";

export function LanguageSwitcher() {
  const pathname = usePathname();
  const router = useRouter();
  const tCommon = useTranslations("common");

  const currentLocale =
    locales.find((loc) => pathname.startsWith(`/${loc}`)) ?? "ca";

  const handleLocaleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newLocale = e.target.value as Locale;
    const newPath = pathname.replace(`/${currentLocale}`, `/${newLocale}`);
    router.push(newPath);
  };

  return (
    <div className="flex items-center gap-1.5 rounded-input border border-border bg-surface px-2 py-1 text-xs text-foreground">
      <Globe className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
      <select
        value={currentLocale}
        onChange={handleLocaleChange}
        className="bg-transparent font-medium focus:outline-none cursor-pointer"
        aria-label={tCommon("changeLanguage")}
      >
        {/* Language names are endonyms on purpose: each is shown in its own language. */}
        <option value="ca" lang="ca">
          Català
        </option>
        <option value="es" lang="es">
          Español
        </option>
        <option value="en" lang="en">
          English
        </option>
      </select>
    </div>
  );
}
