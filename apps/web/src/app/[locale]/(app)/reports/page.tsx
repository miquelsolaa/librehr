"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  BarChart3,
  Users,
  Calendar,
  Clock,
  Download,
  FileSpreadsheet,
  TrendingUp,
  Percent,
} from "lucide-react";
import { Button } from "@librehr/ui";
import { getStoredSession } from "@/lib/auth";
import { getApiClient } from "@/lib/api-client";
import type { ReportsSummaryResponse } from "@librehr/contracts";

export default function ReportsPage() {
  const t = useTranslations("reports");

  const [summary, setSummary] = React.useState<ReportsSummaryResponse | null>(
    null,
  );
  const [loading, setLoading] = React.useState(true);
  const [month, setMonth] = React.useState(
    new Date().toISOString().slice(0, 7),
  );
  const [downloading, setDownloading] = React.useState(false);

  const fetchSummary = React.useCallback(async () => {
    const session = getStoredSession();
    if (!session?.token) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const client = getApiClient(session.token);
      const res = await client.getReportsSummary();
      setSummary(res);
    } catch (err) {
      console.error("Failed to load reports summary", err);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void fetchSummary();
  }, [fetchSummary]);

  const handleDownloadGestoria = async () => {
    const session = getStoredSession();
    if (!session?.token) return;

    try {
      setDownloading(true);
      const token = session.token;
      const url = `${process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001"}/v1/reports/gestoria/export?periodYearMonth=${month}`;
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) throw new Error("Export download failed");

      const blob = await res.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = `gestoria_payroll_${month}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      console.error("Failed to download gestoría export", err);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
          <BarChart3 className="h-7 w-7 text-primary" />
          {t("title")}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">{t("subtitle")}</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-card border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between text-muted-foreground mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">
              {t("kpiHeadcount")}
            </span>
            <Users className="h-4 w-4 text-primary" />
          </div>
          <div className="text-2xl font-bold text-foreground">
            {loading ? "—" : (summary?.headcount.endingHeadcount ?? 0)}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {t("kpiNetChange")}:{" "}
            <span
              className={
                (summary?.headcount.netChange ?? 0) >= 0
                  ? "text-emerald-600 font-medium"
                  : "text-rose-600 font-medium"
              }
            >
              {(summary?.headcount.netChange ?? 0) >= 0 ? "+" : ""}
              {summary?.headcount.netChange ?? 0}
            </span>
          </div>
        </div>

        <div className="rounded-card border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between text-muted-foreground mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">
              {t("kpiTurnover")}
            </span>
            <TrendingUp className="h-4 w-4 text-primary" />
          </div>
          <div className="text-2xl font-bold text-foreground">
            {loading ? "—" : `${summary?.headcount.turnoverRatePercent ?? 0}%`}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            Leavers: {summary?.headcount.leaversCount ?? 0}
          </div>
        </div>

        <div className="rounded-card border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between text-muted-foreground mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">
              {t("kpiAbsenceRate")}
            </span>
            <Percent className="h-4 w-4 text-primary" />
          </div>
          <div className="text-2xl font-bold text-foreground">
            {loading ? "—" : `${summary?.absences.absenceRatePercent ?? 0}%`}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {t("kpiTotalAbsences")}: {summary?.absences.totalAbsentDays ?? 0}{" "}
            days
          </div>
        </div>

        <div className="rounded-card border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between text-muted-foreground mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">
              {t("kpiPlannedDays")}
            </span>
            <Clock className="h-4 w-4 text-primary" />
          </div>
          <div className="text-2xl font-bold text-foreground">
            {loading ? "—" : (summary?.absences.totalPlannedWorkingDays ?? 0)}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            Workforce capacity
          </div>
        </div>
      </div>

      {/* Gestoría Export Section */}
      <div className="rounded-card border border-border bg-card p-6 shadow-sm space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5 text-primary" />
              {t("gestoriaTitle")}
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              {t("gestoriaDesc")}
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 pt-2">
          <div className="w-full sm:w-auto">
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              {t("periodMonth")}
            </label>
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div className="sm:self-end">
            <Button
              onClick={handleDownloadGestoria}
              disabled={downloading}
              className="flex items-center gap-2"
            >
              <Download className="h-4 w-4" />
              {downloading ? "Generating..." : t("downloadGestoriaCsv")}
            </Button>
          </div>
        </div>
      </div>

      {/* iCalendar Subscription Feed Section */}
      <div className="rounded-card border border-border bg-card p-6 shadow-sm space-y-3">
        <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <Calendar className="h-5 w-5 text-primary" />
          {t("calendarFeedTitle")}
        </h2>
        <p className="text-xs text-muted-foreground">{t("calendarFeedDesc")}</p>
        <div>
          <a
            href={`${process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001"}/v1/calendar/feed.ics`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
          >
            <Download className="h-4 w-4" />
            {t("subscribeIcs")}
          </a>
        </div>
      </div>
    </div>
  );
}
