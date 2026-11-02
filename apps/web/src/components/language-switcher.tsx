"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { locales, type Locale } from "@librehr/i18n";
import { Globe } from "lucide-react";

export function LanguageSwitcher() {
  const pathname = usePathname();
  const router = useRouter();

  const currentLocale =
    locales.find((loc) => pathname.startsWith(`/${loc}`)) ?? "ca";

  const handleLocaleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newLocale = e.target.value as Locale;
    const newPath = pathname.replace(`/${currentLocale}`, `/${newLocale}`);
    router.push(newPath);
  };

  return (
    <div className="flex items-center gap-1.5 rounded-input border border-border bg-surface px-2 py-1 text-xs text-foreground">
      <Globe className="h-3.5 w-3.5 text-muted-foreground" />
      <select
        value={currentLocale}
        onChange={handleLocaleChange}
        className="bg-transparent font-medium focus:outline-none cursor-pointer"
        aria-label="Change language"
      >
        <option value="ca">Català</option>
        <option value="es">Español</option>
        <option value="en">English</option>
      </select>
    </div>
  );
}
