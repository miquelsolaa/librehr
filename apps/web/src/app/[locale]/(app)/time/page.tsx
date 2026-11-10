"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, PageHeader } from "@librehr/ui";
import {
  Clock,
  FileText,
  CheckCircle2,
  AlertTriangle,
  Coffee,
  Tablet,
  Hourglass,
  Repeat,
} from "lucide-react";
import { getStoredSession } from "@/lib/auth";
import { ClockWidget } from "@/components/clock-widget";
import { getApiClient } from "@/lib/api-client";
import type {
  PeriodTimesheetResponse,
  TimeBankSummary,
} from "@librehr/contracts";

export default function TimeTrackingPage() {
  const params = useParams();
  const locale = (params?.["locale"] as string | undefined) ?? "ca";

  const t = useTranslations("timeTracking");

  const [timesheet, setTimesheet] =
    React.useState<PeriodTimesheetResponse | null>(null);
  const [timeBank, setTimeBank] = React.useState<TimeBankSummary | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<
    "unavailable" | "schedule" | null
  >(null);
  const [timeBankError, setTimeBankError] = React.useState(false);

  const fetchTimesheet = React.useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setTimeBankError(false);
    const session = getStoredSession();
    if (!session) {
      setLoadError("unavailable");
      setLoading(false);
      return;
    }

    try {
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
        .toISOString()
        .slice(0, 10);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0)
        .toISOString()
        .slice(0, 10);

      const client = getApiClient();
      const [tsRes, tbRes] = await Promise.all([
        client.getTimesheet({
          startDate: startOfMonth,
          endDate: endOfMonth,
        }),
        client.getTimeBank().catch(() => {
          setTimeBankError(true);
          return null;
        }),
      ]);

      setTimesheet(tsRes);
      setTimeBank(tbRes);
    } catch (error: unknown) {
      setTimesheet(null);
      setTimeBank(null);
      setLoadError(
        typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "SCHEDULE_NOT_CONFIGURED"
          ? "schedule"
          : "unavailable",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void fetchTimesheet();
  }, [fetchTimesheet]);

  const formatMinutes = (mins: number) => {
    const abs = Math.abs(mins);
    const h = Math.floor(abs / 60);
    const m = abs % 60;
    const sign = mins < 0 ? "-" : "";
    return `${sign}${h}h ${m}m`;
  };

  return (
    <div className="space-y-8">
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          <>
            <Button
              asChild
              variant="outline"
              className="min-h-11 max-w-full gap-2"
            >
              <Link href={`/${locale}/kiosk`} className="gap-2">
                <Tablet className="h-4 w-4" />
                {t("kioskTitle")}
              </Link>
            </Button>

            <Button
              asChild
              variant="outline"
              className="min-h-11 max-w-full gap-2"
            >
              <Link href={`/${locale}/time/shifts`} className="gap-2">
                <Repeat className="h-4 w-4" />
                {t("shiftsNav")}
              </Link>
            </Button>

            <Button
              asChild
              variant="outline"
              className="min-h-11 max-w-full gap-2"
            >
              <Link href={`/${locale}/time/corrections`} className="gap-2">
                <CheckCircle2 className="h-4 w-4" />
                {t("correctionsTitle")}
              </Link>
            </Button>

            <Button
              asChild
              variant="default"
              className="min-h-11 max-w-full gap-2"
            >
              <Link href={`/${locale}/time/export`} className="gap-2">
                <FileText className="h-4 w-4" />
                {t("exportTitle")}
              </Link>
            </Button>
          </>
        }
      />

      <div className="sm:hidden">
        <ClockWidget onClockChange={() => void fetchTimesheet()} />
      </div>

      {loadError && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border bg-surface p-5"
        >
          <p className="text-sm text-foreground">
            {t(
              loadError === "schedule"
                ? "scheduleNotConfigured"
                : "timesheetUnavailable",
            )}
          </p>
          <Button variant="outline" onClick={() => void fetchTimesheet()}>
            {t("retry")}
          </Button>
        </div>
      )}
      {timeBankError && !loadError && (
        <p role="status" className="text-sm text-muted-foreground">
          {t("timeBankUnavailable")}
        </p>
      )}
      {!loadError && (
        <>
          {/* Monthly Summary KPI Cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-border bg-surface p-5 shadow-sm">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-sm font-medium">{t("periodWorked")}</span>
                <Clock className="h-4 w-4 text-primary" />
              </div>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="text-2xl font-semibold tracking-tight tabular-nums text-foreground">
                  {loading
                    ? "..."
                    : formatMinutes(timesheet?.totalWorkedMinutes ?? 0)}
                </span>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-surface p-5 shadow-sm">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-sm font-medium">{t("periodBreaks")}</span>
                <Coffee className="h-4 w-4 text-amber-600" />
              </div>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="text-2xl font-semibold tracking-tight tabular-nums text-foreground">
                  {loading
                    ? "..."
                    : formatMinutes(timesheet?.totalBreakMinutes ?? 0)}
                </span>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-surface p-5 shadow-sm">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-sm font-medium">{t("expected")}</span>
                <Clock className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="text-2xl font-semibold tracking-tight tabular-nums text-foreground">
                  {loading ? "..." : `${timesheet?.totalExpectedHours ?? 0}h`}
                </span>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-surface p-5 shadow-sm">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-sm font-medium">
                  {t("periodOvertime")}
                </span>
                <AlertTriangle className="h-4 w-4 text-indigo-600" />
              </div>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="text-2xl font-semibold tracking-tight tabular-nums text-foreground">
                  {loading
                    ? "..."
                    : formatMinutes(timesheet?.totalOvertimeMinutes ?? 0)}
                </span>
              </div>
            </div>
          </div>

          {/* Time Bank & Compensatory Rest (TIM-012) */}
          {timeBank && (
            <div className="rounded-xl border border-border bg-surface p-6 shadow-sm">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-border pb-4 mb-4">
                <div className="flex items-center gap-3">
                  <Hourglass className="h-5 w-5 text-indigo-600" />
                  <div>
                    <h2 className="text-base font-semibold text-foreground">
                      {t("timeBankTitle")}
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      {t("timeBankSubtitle")}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-muted-foreground">
                    {t("timeBankBalance")}:
                  </span>
                  <span className="rounded-full bg-indigo-50 px-3 py-1 font-mono text-sm font-bold text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300">
                    {timeBank.currentBalanceHoursFormatted}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="rounded-lg bg-surface p-4">
                  <span className="text-xs text-muted-foreground">
                    {t("timeBankAccrued")}
                  </span>
                  <p className="mt-1 font-mono text-lg font-bold text-foreground">
                    {formatMinutes(timeBank.totalAccruedMinutes)}
                  </p>
                </div>
                <div className="rounded-lg bg-surface p-4">
                  <span className="text-xs text-muted-foreground">
                    {t("timeBankCompensated")}
                  </span>
                  <p className="mt-1 font-mono text-lg font-bold text-foreground">
                    {formatMinutes(timeBank.totalCompensatedMinutes)}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Timesheet Days Table */}
          <div className="rounded-xl border border-border bg-surface p-6 shadow-sm space-y-4">
            <h2 className="text-base font-semibold text-foreground">
              {t("timesheetTitle")}
            </h2>

            {loading ? (
              <p
                role="status"
                className="py-12 text-center text-sm text-muted-foreground"
              >
                {t("loadingRecords")}
              </p>
            ) : !timesheet || timesheet.days.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                {t("noRecords")}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-border text-xs font-semibold uppercase text-muted-foreground">
                    <tr>
                      <th className="pb-3">{t("date")}</th>
                      <th className="pb-3">{t("worked")}</th>
                      <th className="pb-3">{t("breaks")}</th>
                      <th className="pb-3">{t("expected")}</th>
                      <th className="pb-3">{t("overtime")}</th>
                      <th className="pb-3 text-right">{t("actions")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {timesheet.days.map((d) => (
                      <tr key={d.date} className="hover:bg-surface">
                        <td className="py-3 font-medium text-foreground">
                          {d.date}
                        </td>
                        <td className="py-3 text-muted-foreground">
                          {formatMinutes(d.totalWorkedMinutes)}
                        </td>
                        <td className="py-3 text-muted-foreground">
                          {formatMinutes(d.totalBreakMinutes)}
                        </td>
                        <td className="py-3 text-muted-foreground">
                          {d.expectedHours}h
                        </td>
                        <td
                          className={`py-3 font-semibold ${d.overtimeMinutes < 0 ? "text-amber-600" : "text-emerald-600"}`}
                        >
                          {formatMinutes(d.overtimeMinutes)}
                        </td>
                        <td className="py-3 text-right">
                          <Link
                            href={`/${locale}/time/corrections?date=${d.date}`}
                            className="text-xs font-medium text-primary hover:underline"
                          >
                            {t("proposeCorrection")}
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
