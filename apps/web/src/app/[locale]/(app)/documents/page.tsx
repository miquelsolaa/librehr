"use client";

import { useTranslations } from "next-intl";
import { EmptyState } from "@openhr/ui";
import { FileText } from "lucide-react";

// TODO(DOC-001): Document storage and folder management
export default function DocumentsPage() {
  const tHome = useTranslations("home");
  const tNav = useTranslations("nav");

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight text-foreground">
        {tNav("documents")}
      </h1>
      <EmptyState
        icon={<FileText className="h-6 w-6" />}
        title={tHome("emptyModuleTitle")}
        description={tHome("emptyModuleDescription")}
      />
    </div>
  );
}
