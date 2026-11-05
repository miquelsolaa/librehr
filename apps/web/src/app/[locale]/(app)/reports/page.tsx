"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { BarChart3, FileSpreadsheet } from "lucide-react";
import { getStoredSession } from "@/lib/auth";

export default function ReportsPage() {
  const t = useTranslations("reports");
  const locale = String(useParams()?.["locale"] ?? "ca");
  const [state, setState] = React.useState<"loading" | "signIn" | "ready">(
    "loading",
  );
  React.useEffect(() => {
    setState(getStoredSession()?.token ? "ready" : "signIn");
  }, []);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-foreground">
          <BarChart3 className="h-7 w-7 text-primary" aria-hidden="true" />
          {t("title")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </header>
      {state === "loading" && (
        <p role="status" className="text-sm text-muted-foreground">
          {t("loading")}
        </p>
      )}
      {state === "signIn" && (
        <div className="space-y-3 rounded-card border border-border bg-surface p-6">
          <p>{t("signInRequired")}</p>
          <Link
            href={`/${locale}/sign-in`}
            className="inline-flex min-h-11 items-center rounded-input bg-primary px-4 text-sm font-medium text-primary-foreground"
          >
            {t("signIn")}
          </Link>
        </div>
      )}
      {state === "ready" && (
        <>
          <p
            role="status"
            className="rounded-input border border-border bg-surface p-4 text-sm text-muted-foreground"
          >
            {t("approximateData")}
          </p>
          <section className="space-y-4 rounded-card border border-border bg-surface p-6">
            <div>
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                <FileSpreadsheet
                  className="h-5 w-5 text-primary"
                  aria-hidden="true"
                />
                {t("gestoriaTitle")}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("gestoriaDesc")}
              </p>
            </div>
            <p role="status" className="text-sm text-muted-foreground">
              {t("exportUnavailable")}
            </p>
          </section>
        </>
      )}
    </div>
  );
}
