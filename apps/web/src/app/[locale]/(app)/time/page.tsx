"use client";

import { useTranslations } from "next-intl";
import { EmptyState } from "@openhr/ui";
import { Clock } from "lucide-react";

// TODO(TIM-001): Workday tracking, clocking events, and hours records
export default function TimePage() {
  const tHome = useTranslations("home");
  const tNav = useTranslations("nav");

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight text-foreground">
        {tNav("time")}
      </h1>
      <EmptyState
        icon={<Clock className="h-6 w-6" />}
        title={tHome("emptyModuleTitle")}
        description={tHome("emptyModuleDescription")}
      />
    </div>
  );
}
