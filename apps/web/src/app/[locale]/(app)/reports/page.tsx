"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { BarChart3, FileSpreadsheet } from "lucide-react";
import { getStoredSession } from "@/lib/auth";
import { apiClient } from "@/lib/api-client";
import {
  HeadcountReportResponseSchema,
  type HeadcountReportResponse,
} from "@librehr/contracts";

export default function ReportsPage() {
  const t = useTranslations("reports");
  const locale = String(useParams()?.["locale"] ?? "ca");
  const [state, setState] = React.useState<"loading" | "signIn" | "ready">(
    "loading",
  );
  const [startDate, setStartDate] = React.useState("");
  const [endDate, setEndDate] = React.useState("");
  const [headcount, setHeadcount] =
    React.useState<HeadcountReportResponse | null>(null);
  const [headcountError, setHeadcountError] = React.useState(false);
  const [fetching, setFetching] = React.useState(false);
  const [exporting, setExporting] = React.useState(false);
  const [exportError, setExportError] = React.useState(false);
  React.useEffect(() => {
    setState(getStoredSession() ? "ready" : "signIn");
  }, []);

  async function loadHeadcount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFetching(true);
    setHeadcount(null);
    setHeadcountError(false);
    setExportError(false);
    try {
      setHeadcount(
        HeadcountReportResponseSchema.parse(
          await apiClient.getHeadcountReport(startDate, endDate),
        ),
      );
    } catch {
      setHeadcountError(true);
    } finally {
      setFetching(false);
    }
  }

  async function downloadHeadcount() {
    if (!headcount) return;
    setExporting(true);
    setExportError(false);
    try {
      const csv = await apiClient.exportHeadcountCsv(
        headcount.periodStart,
        headcount.periodEnd,
      );
      const url = URL.createObjectURL(
        new Blob([csv], { type: "text/csv;charset=utf-8" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `headcount-${headcount.periodStart}-${headcount.periodEnd}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setExportError(true);
    } finally {
      setExporting(false);
    }
  }

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
          <section className="space-y-4 rounded-card border border-border bg-surface p-6">
            <h2 className="text-lg font-semibold">{t("headcountTitle")}</h2>
            <p className="text-sm text-muted-foreground">
              {t("headcountDescription")}
            </p>
            <form
              onSubmit={loadHeadcount}
              className="flex flex-wrap items-end gap-4"
            >
              <label className="grid gap-1 text-sm">
                {t("headcountStart")}
                <input
                  className="rounded-input border border-border bg-background p-2"
                  type="date"
                  value={startDate}
                  onChange={(event) => {
                    setStartDate(event.target.value);
                    setHeadcount(null);
                    setHeadcountError(false);
                  }}
                  required
                />
              </label>
              <label className="grid gap-1 text-sm">
                {t("headcountEnd")}
                <input
                  className="rounded-input border border-border bg-background p-2"
                  type="date"
                  value={endDate}
                  onChange={(event) => {
                    setEndDate(event.target.value);
                    setHeadcount(null);
                    setHeadcountError(false);
                  }}
                  min={startDate}
                  required
                />
              </label>
              <button
                className="min-h-11 rounded-input bg-primary px-4 text-primary-foreground"
                type="submit"
                disabled={fetching}
              >
                {fetching ? t("loading") : t("headcountSubmit")}
              </button>
            </form>
            {headcountError && (
              <p role="alert" className="text-sm text-danger">
                {t("headcountError")}
              </p>
            )}
            {headcount && (
              <>
                <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                  {(
                    [
                      [
                        "headcountStartCount",
                        headcount.headcount.startingHeadcount,
                      ],
                      [
                        "headcountEndCount",
                        headcount.headcount.endingHeadcount,
                      ],
                      ["headcountJoiners", headcount.headcount.joinersCount],
                      ["headcountLeavers", headcount.headcount.leaversCount],
                      ["headcountNet", headcount.headcount.netChange],
                      [
                        "headcountTurnover",
                        `${headcount.headcount.turnoverRatePercent}%`,
                      ],
                    ] as const
                  ).map(([key, value]) => (
                    <div key={key}>
                      <dt className="text-sm text-muted-foreground">
                        {t(key)}
                      </dt>
                      <dd className="text-xl font-semibold">{value}</dd>
                    </div>
                  ))}
                </dl>
                <button
                  type="button"
                  onClick={downloadHeadcount}
                  disabled={exporting}
                  className="min-h-11 rounded-input border border-border px-4 text-sm"
                >
                  {exporting ? t("loading") : t("headcountDownload")}
                </button>
                {exportError && (
                  <p role="alert" className="text-sm text-danger">
                    {t("headcountDownloadError")}
                  </p>
                )}
              </>
            )}
          </section>
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
