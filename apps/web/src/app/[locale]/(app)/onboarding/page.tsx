"use client";

import { useTranslations } from "next-intl";
import { EmptyState } from "@openhr/ui";
import { UserCheck } from "lucide-react";

// TODO(ONB-001): Onboarding and offboarding checklists
export default function OnboardingPage() {
  const tHome = useTranslations("home");
  const tNav = useTranslations("nav");

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight text-foreground">
        {tNav("onboarding")}
      </h1>
      <EmptyState
        icon={<UserCheck className="h-6 w-6" />}
        title={tHome("emptyModuleTitle")}
        description={tHome("emptyModuleDescription")}
      />
    </div>
  );
}
