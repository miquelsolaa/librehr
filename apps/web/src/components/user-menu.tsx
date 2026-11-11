"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { LogOut } from "lucide-react";
import { locales, type Locale } from "@librehr/i18n";
import {
  Avatar,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@librehr/ui";
import { signOut } from "@/lib/auth";

// Endonyms on purpose: each language is shown in its own language.
const LANGUAGE_NAMES: Record<Locale, string> = {
  ca: "Català",
  es: "Español",
  en: "English",
};

const ROLE_KEYS = {
  admin: "roleAdmin",
  manager: "roleManager",
  employee: "roleEmployee",
  auditor: "roleAuditor",
} as const;

function isRole(role: string): role is keyof typeof ROLE_KEYS {
  return role in ROLE_KEYS;
}

export interface UserMenuProps {
  name: string;
  role: string | null;
}

/** Account menu: who is signed in, language, theme and sign-out. */
export function UserMenu({ name, role }: UserMenuProps) {
  const pathname = usePathname();
  const router = useRouter();
  const tNav = useTranslations("nav");
  const tCommon = useTranslations("common");
  const tAuth = useTranslations("auth");
  const tRoles = useTranslations("invitations");
  const { theme, setTheme } = useTheme();
  const [signingOut, setSigningOut] = React.useState(false);
  const id = React.useId();

  const currentLocale =
    locales.find(
      (loc) => pathname === `/${loc}` || pathname.startsWith(`/${loc}/`),
    ) ?? "ca";

  const changeLocale = (value: string) => {
    const next = locales.find((loc) => loc === value);
    if (!next || next === currentLocale) return;
    router.push(pathname.replace(`/${currentLocale}`, `/${next}`));
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
    } catch {
      // The local profile is cleared regardless; the cookie expires anyway.
    } finally {
      router.push(`/${currentLocale}/sign-in`);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="inline-flex h-11 w-11 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
        {/* Named by its text, not aria-label: the initials are decorative and
            would otherwise be visible text missing from the name (WCAG 2.5.3). */}
        <Avatar
          name={name}
          size="sm"
          aria-hidden="true"
          aria-label={undefined}
        />
        <span className="sr-only">{tNav("accountMenu")}</span>
      </DropdownMenuTrigger>
      {/* The identity block is not a menu item, so describe the menu with it. */}
      <DropdownMenuContent aria-describedby={`${id}-who`}>
        <div id={`${id}-who`} className="px-3 py-2">
          <p className="truncate text-sm font-semibold text-foreground">
            {name}
          </p>
          {role && (
            <p className="text-xs text-muted-foreground">
              {isRole(role) ? tRoles(ROLE_KEYS[role]) : role}
            </p>
          )}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuLabel id={`${id}-language`}>
          {tCommon("language")}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          aria-labelledby={`${id}-language`}
          value={currentLocale}
          onValueChange={changeLocale}
        >
          {locales.map((loc) => (
            <DropdownMenuRadioItem key={loc} value={loc} lang={loc}>
              {LANGUAGE_NAMES[loc]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel id={`${id}-theme`}>
          {tNav("theme")}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          aria-labelledby={`${id}-theme`}
          value={theme ?? "system"}
          onValueChange={setTheme}
        >
          <DropdownMenuRadioItem value="light">
            {tCommon("theme.light")}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            {tCommon("theme.dark")}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">
            {tCommon("theme.system")}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={signingOut}
          onSelect={() => void handleSignOut()}
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
          {tAuth("signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
