"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Calendar, Clock, FileText } from "lucide-react";
import { ClockWidget } from "@/components/clock-widget";
import { getStoredSession } from "@/lib/auth";
import { getApiClient } from "@/lib/api-client";

export default function HomePage() {
  const t = useTranslations("home");
  const locale = String(useParams()?.["locale"] ?? "ca");
  const [session, setSession] =
    React.useState<ReturnType<typeof getStoredSession>>(null);
  const [ready, setReady] = React.useState(false);
  const [balance, setBalance] = React.useState<number | null>(null);
  const [balanceError, setBalanceError] = React.useState(false);

  const loadBalance = React.useCallback(async () => {
    const current = getStoredSession();
    setSession(current);
    setBalanceError(false);
    if (current?.token) {
      try {
        const result = await getApiClient(current.token).getLeaveBalance();
        setBalance(result.currentBalance);
      } catch {
        setBalance(null);
        setBalanceError(true);
      }
    }
    setReady(true);
  }, []);

  React.useEffect(() => {
    void loadBalance();
  }, [loadBalance]);

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
          {session?.name
            ? t("welcome", { name: session.name })
            : t("homeTitle")}
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          {t("homeIntro")}
        </p>
      </header>
      {!ready ? (
        <p role="status">{t("loadingHome")}</p>
      ) : !session?.token ? (
        <section className="rounded-card border border-border bg-surface p-6 space-y-3">
          <p>{t("signInPrompt")}</p>
          <Link
            className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
            href={`/${locale}/sign-in`}
          >
            {t("signIn")}
          </Link>
        </section>
      ) : (
        <div className="grid gap-5 md:grid-cols-2">
          <section className="space-y-4 rounded-card border border-border bg-surface p-6">
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-primary" aria-hidden="true" />
              <h2 className="text-lg font-semibold">{t("yourTime")}</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              {t("timeDescription")}
            </p>
            <ClockWidget />
            <Link
              className="inline-block text-sm font-medium text-primary underline underline-offset-4"
              href={`/${locale}/time`}
            >
              {t("viewTime")}
            </Link>
          </section>
          <section className="space-y-4 rounded-card border border-border bg-surface p-6">
            <div className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-primary" aria-hidden="true" />
              <h2 className="text-lg font-semibold">{t("yourTimeOff")}</h2>
            </div>
            {balanceError ? (
              <div role="alert" className="space-y-2 text-sm">
                <p>{t("balanceUnavailable")}</p>
                <button
                  type="button"
                  className="font-medium text-primary underline underline-offset-4"
                  onClick={() => void loadBalance()}
                >
                  {t("retryHome")}
                </button>
              </div>
            ) : balance === null ? (
              <p role="status">{t("loadingHome")}</p>
            ) : (
              <p className="text-3xl font-semibold tabular-nums">
                {new Intl.NumberFormat(locale).format(balance)}{" "}
                <span className="text-sm font-normal text-muted-foreground">
                  {t("daysRemaining")}
                </span>
              </p>
            )}
            <Link
              className="inline-block text-sm font-medium text-primary underline underline-offset-4"
              href={`/${locale}/time-off`}
            >
              {t("viewTimeOff")}
            </Link>
          </section>
          <Link
            className="flex min-h-14 items-center gap-3 rounded-card border border-border bg-surface px-6 font-medium hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:col-span-2"
            href={`/${locale}/documents`}
          >
            <FileText className="h-5 w-5 text-primary" aria-hidden="true" />
            {t("viewDocuments")}
          </Link>
        </div>
      )}
    </div>
  );
}
