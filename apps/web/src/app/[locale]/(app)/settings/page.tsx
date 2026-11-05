"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Building2,
  MapPin,
  KeyRound,
  Sliders,
  ShieldCheck,
  Globe,
  Webhook,
  ChevronRight,
  Clock,
} from "lucide-react";

export default function SettingsPage() {
  const params = useParams();
  const locale = (params?.["locale"] as string) ?? "es";
  const tNav = useTranslations("nav");
  const t = useTranslations("settings");
  const tSchedule = useTranslations("scheduleSettings");

  const settingsCards = [
    {
      title: tSchedule("title"),
      description: tSchedule("linkDescription"),
      href: `/${locale}/settings/time`,
      icon: <Clock className="h-5 w-5 text-primary" />,
    },
    {
      title: t("departmentsTitle"),
      description: t("departmentsDescription"),
      href: `/${locale}/settings/departments`,
      icon: <Building2 className="h-5 w-5 text-primary" />,
    },
    {
      title: t("locationsTitle"),
      description: t("locationsDescription"),
      href: `/${locale}/settings/locations`,
      icon: <MapPin className="h-5 w-5 text-primary" />,
    },
    {
      title: t("tokensTitle"),
      description: t("tokensDescription"),
      href: `/${locale}/settings/tokens`,
      icon: <KeyRound className="h-5 w-5 text-primary" />,
    },
    {
      title: "Custom Profile Fields",
      description: "Manage dynamic employee profile fields and attributes.",
      href: `/${locale}/settings/custom-fields`,
      icon: <Sliders className="h-5 w-5 text-primary" />,
    },
    {
      title: t("securityCardTitle"),
      description: t("securityCardDescription"),
      href: `/${locale}/settings/security`,
      icon: <ShieldCheck className="h-5 w-5 text-primary" />,
    },
    {
      title: t("ssoCardTitle"),
      description: t("ssoCardDescription"),
      href: `/${locale}/settings/sso`,
      icon: <Globe className="h-5 w-5 text-primary" />,
    },
    {
      title: t("webhooksCardTitle"),
      description: t("webhooksCardDescription"),
      href: `/${locale}/settings/webhooks`,
      icon: <Webhook className="h-5 w-5 text-primary" />,
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          {tNav("settings")}
        </h1>
        <p className="text-sm text-muted-foreground">
          Manage statutory configuration, work centers, and organizational
          units.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {settingsCards.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className="group flex items-center justify-between rounded-card border border-border bg-surface p-5 hover:border-primary/50 hover:bg-surface-raised transition-all"
          >
            <div className="flex items-center gap-4">
              <div className="flex h-11 w-11 items-center justify-center rounded-btn bg-primary/10">
                {card.icon}
              </div>
              <div>
                <h2 className="text-base font-semibold text-foreground group-hover:text-primary transition-colors">
                  {card.title}
                </h2>
                <p className="text-xs text-muted-foreground line-clamp-2">
                  {card.description}
                </p>
              </div>
            </div>
            <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
          </Link>
        ))}
      </div>
    </div>
  );
}
