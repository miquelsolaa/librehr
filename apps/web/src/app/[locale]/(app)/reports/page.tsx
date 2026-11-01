"use client";

import { useTranslations } from "next-intl";
import { EmptyState } from "@openhr/ui";
import { BarChart3 } from "lucide-react";

// TODO(REP-001): Working-time inspections and standard reports
export default function ReportsPage() {
  const tHome = useTranslations("home");
  const tNav = useTranslations("nav");

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight text-foreground">
        {tNav("reports")}
      </h1>
      <EmptyState
        icon={<BarChart3 className="h-6 w-6" />}
        title={tHome("emptyModuleTitle")}
        description={tHome("emptyModuleDescription")}
      />
    </div>
  );
}
