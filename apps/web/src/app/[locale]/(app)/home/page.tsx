"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, PageHeader, Skeleton } from "@librehr/ui";
import { ClockWidget } from "@/components/clock-widget";
import { getStoredSession } from "@/lib/auth";
import { getApiClient } from "@/lib/api-client";

const linkClass =
  "inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring rounded-input";

export default function HomePage() {
  const t = useTranslations("home");
  const locale = String(useParams()?.["locale"] ?? "ca");
  const [session, setSession] =
    React.useState<ReturnType<typeof getStoredSession>>(null);
  const [ready, setReady] = React.useState(false);
  const [today, setToday] = React.useState<string | null>(null);
  const [balance, setBalance] = React.useState<number | null>(null);
  const [balanceError, setBalanceError] = React.useState(false);

  // Only the latest request may update the page, and none after unmount.
  const requestRef = React.useRef(0);
  React.useEffect(() => () => void (requestRef.current += 1), []);

  const loadBalance = React.useCallback(async () => {
    const request = ++requestRef.current;
    setBalanceError(false);
    setBalance(null);
    try {
      const result = await getApiClient().getLeaveBalance();
      if (request === requestRef.current) setBalance(result.currentBalance);
    } catch {
      if (request === requestRef.current) setBalanceError(true);
    }
  }, []);

  React.useEffect(() => {
    const current = getStoredSession();
    setSession(current);
    // Formatted in the browser so the date is the viewer's local day.
    setToday(
      new Intl.DateTimeFormat(locale, {
        weekday: "long",
        day: "numeric",
        month: "long",
      }).format(new Date()),
    );
    setReady(true);
    if (current) void loadBalance();
  }, [locale, loadBalance]);

  const balanceLoading = balance === null && !balanceError;

  return (
    <div className="space-y-8">
      <PageHeader
        title={
          session?.name ? t("welcome", { name: session.name }) : t("homeTitle")
        }
        description={today ?? undefined}
      />
      {!ready ? (
        <div aria-busy="true" className="grid gap-5 md:grid-cols-[3fr_2fr]">
          <Skeleton className="h-40 rounded-card" />
          <Skeleton className="h-40 rounded-card" />
        </div>
      ) : !session ? (
        <section className="rounded-card border border-border bg-surface p-6 space-y-3">
          <p>{t("signInPrompt")}</p>
          <Button asChild>
            <Link href={`/${locale}/sign-in`}>{t("signIn")}</Link>
          </Button>
        </section>
      ) : (
        <div className="grid items-start gap-5 md:grid-cols-[3fr_2fr]">
          <section
            aria-labelledby="home-time"
            className="rounded-card border border-border bg-surface p-6"
          >
            {/* The clock's own status line is the visible title of this block. */}
            <h2 id="home-time" className="sr-only">
              {t("yourTime")}
            </h2>
            <div className="space-y-4">
              <ClockWidget />
              <Link className={linkClass} href={`/${locale}/time`}>
                {t("viewTime")}
              </Link>
            </div>
          </section>
          <section
            aria-labelledby="home-time-off"
            aria-busy={balanceLoading || undefined}
            className="space-y-4 rounded-card border border-border bg-surface p-6"
          >
            <h2
              id="home-time-off"
              className="text-base font-semibold text-foreground"
            >
              {t("yourTimeOff")}
            </h2>
            {balanceError ? (
              <div role="alert" className="space-y-2 text-sm">
                <p>{t("balanceUnavailable")}</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void loadBalance()}
                >
                  {t("retryHome")}
                </Button>
              </div>
            ) : balance === null ? (
              <Skeleton className="h-10 w-40" />
            ) : (
              <p className="flex items-baseline gap-2">
                <span className="text-4xl font-semibold tabular-nums text-foreground">
                  {new Intl.NumberFormat(locale).format(balance)}
                </span>
                <span className="text-sm text-muted-foreground">
                  {t("daysRemaining")}
                </span>
              </p>
            )}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <Button asChild>
                <Link href={`/${locale}/time-off/request`}>
                  {t("requestLeave")}
                </Link>
              </Button>
              <Link className={linkClass} href={`/${locale}/time-off`}>
                {t("viewTimeOff")}
              </Link>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
