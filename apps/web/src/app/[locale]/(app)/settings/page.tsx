"use client";

import { useTranslations } from "next-intl";
import { EmptyState } from "@openhr/ui";
import { Settings } from "lucide-react";

// TODO(ORG-001): Organization settings and legal entities
export default function SettingsPage() {
  const tHome = useTranslations("home");
  const tNav = useTranslations("nav");

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight text-foreground">
        {tNav("settings")}
      </h1>
      <EmptyState
        icon={<Settings className="h-6 w-6" />}
        title={tHome("emptyModuleTitle")}
        description={tHome("emptyModuleDescription")}
      />
    </div>
  );
}
