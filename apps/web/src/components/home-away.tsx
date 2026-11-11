"use client";

import * as React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { TeamAbsence } from "@librehr/contracts";
import { Button, Skeleton } from "@librehr/ui";
import { getApiClient } from "@/lib/api-client";
import { formatCalendarDate, localIsoDate } from "@/lib/format";

const DAYS_AHEAD = 6;
const MAX_ROWS = 6;

/**
 * Who is away over the next week (LEA-006). Names and dates only: the kind of
 * leave stays on the team calendar, where the API decides who may see it.
 */
export function HomeAway({ locale }: { locale: string }) {
  const t = useTranslations("home");
  const [absences, setAbsences] = React.useState<TeamAbsence[] | null>(null);
  const [failed, setFailed] = React.useState(false);

  // Only the latest request may update the block, and none after unmount.
  const requestRef = React.useRef(0);
  React.useEffect(() => () => void (requestRef.current += 1), []);

  const load = React.useCallback(async () => {
    const request = ++requestRef.current;
    setFailed(false);
    setAbsences(null);
    const today = new Date();
    const until = new Date(today);
    until.setDate(today.getDate() + DAYS_AHEAD);
    try {
      const result = await getApiClient().listTeamAbsences({
        startDate: localIsoDate(today),
        endDate: localIsoDate(until),
      });
      if (request !== requestRef.current) return;
      setAbsences(
        result
          .filter((absence) => absence.status === "approved")
          .sort((a, b) => a.startDate.localeCompare(b.startDate)),
      );
    } catch {
      if (request === requestRef.current) setFailed(true);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const day = (date: string) =>
    formatCalendarDate(date, locale, {
      dateStyle: undefined,
      weekday: "short",
      day: "numeric",
      month: "short",
    });
  const shown = absences?.slice(0, MAX_ROWS) ?? [];
  const hidden = (absences?.length ?? 0) - shown.length;

  return (
    <section
      aria-labelledby="home-away"
      aria-busy={(absences === null && !failed) || undefined}
      className="overflow-hidden rounded-card border border-border bg-surface"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-border px-5 py-4 sm:px-6">
        <h2 id="home-away" className="text-base font-semibold text-foreground">
          {t("awayThisWeek")}
        </h2>
        <Link
          href={`/${locale}/time-off/calendar`}
          className="inline-flex min-h-11 items-center rounded-input text-sm font-medium text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          {t("viewCalendar")}
        </Link>
      </div>
      {failed ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 px-5 py-4 text-sm sm:px-6"
        >
          <p>{t("awayUnavailable")}</p>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            {t("retryHome")}
          </Button>
        </div>
      ) : absences === null ? (
        <div className="space-y-3 px-5 py-4 sm:px-6">
          <Skeleton className="h-5 w-64 max-w-full" />
          <Skeleton className="h-5 w-52 max-w-full" />
        </div>
      ) : shown.length === 0 ? (
        <p className="px-5 py-5 text-sm text-muted-foreground sm:px-6">
          {t("nobodyAway")}
        </p>
      ) : (
        <>
          <ul className="divide-y divide-border">
            {shown.map((absence) => (
              <li
                key={absence.requestId}
                className="grid grid-cols-1 gap-x-4 gap-y-0.5 px-5 py-3 text-sm sm:grid-cols-[13rem_minmax(0,1fr)] sm:px-6"
              >
                <span className="tabular-nums text-muted-foreground">
                  {absence.startDate === absence.endDate
                    ? day(absence.startDate)
                    : `${day(absence.startDate)} – ${day(absence.endDate)}`}
                </span>
                <span className="min-w-0 truncate font-medium text-foreground">
                  {absence.employeeName}
                </span>
              </li>
            ))}
          </ul>
          {hidden > 0 && (
            <p className="border-t border-border px-5 py-3 text-sm text-muted-foreground sm:px-6">
              {t("moreAway", { count: hidden })}
            </p>
          )}
        </>
      )}
    </section>
  );
}
