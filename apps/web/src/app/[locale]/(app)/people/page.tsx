"use client";

import { useTranslations } from "next-intl";
import { EmptyState } from "@openhr/ui";
import { Users } from "lucide-react";

// TODO(EMP-001): Employee list and profiles directory
export default function PeoplePage() {
  const tHome = useTranslations("home");
  const tNav = useTranslations("nav");

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight text-foreground">
        {tNav("people")}
      </h1>
      <EmptyState
        icon={<Users className="h-6 w-6" />}
        title={tHome("emptyModuleTitle")}
        description={tHome("emptyModuleDescription")}
      />
    </div>
  );
}
