"use client";

import { useTranslations } from "next-intl";
import { EmptyState } from "@openhr/ui";
import { Calendar } from "lucide-react";

// TODO(LEA-001): Time off balance, leave requests, and approval workflow
export default function TimeOffPage() {
  const tHome = useTranslations("home");
  const tNav = useTranslations("nav");

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight text-foreground">
        {tNav("timeOff")}
      </h1>
      <EmptyState
        icon={<Calendar className="h-6 w-6" />}
        title={tHome("emptyModuleTitle")}
        description={tHome("emptyModuleDescription")}
      />
    </div>
  );
}
