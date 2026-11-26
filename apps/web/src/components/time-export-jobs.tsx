"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Button, StatusPill, type StatusPillType } from "@librehr/ui";
import { Clock, Download } from "lucide-react";
import type { TimeExportJob } from "@librehr/contracts";
import { downloadTimeExportJob, getApiClient } from "@/lib/api-client";
import { formatCalendarDate, formatDateTime } from "@/lib/format";
import {
  exportErrorKey,
  exportPollDelay,
  isActiveExportJob,
  saveBlob,
  type ExportErrorKey,
  type ExportLocale,
} from "@/lib/time-export";
import type { TimeExportFile } from "@/lib/api-client";

/** A refused synchronous organization export that may run in the background. */
export interface BackgroundExportOffer {
  startDate: string;
  endDate: string;
  locale: ExportLocale;
}

export interface TimeExportJobsProps {
  locale: string;
  offer: BackgroundExportOffer | null;
  onQueued: () => void;
  onDownloaded: (file: TimeExportFile) => void;
}

const PILL: Record<
  TimeExportJob["status"],
  { pill: StatusPillType; label: string }
> = {
  queued: { pill: "pending", label: "exportJobsStatusQueued" },
  running: { pill: "pending", label: "exportJobsStatusRunning" },
  ready: { pill: "approved", label: "exportJobsStatusReady" },
  failed: { pill: "rejected", label: "exportJobsStatusFailed" },
  expired: { pill: "inactive", label: "exportJobsStatusExpired" },
};

/** The `?job=` id a notification links to, read after mount. */
function linkedJobId(): string | null {
  try {
    return new URLSearchParams(window.location.search).get("job");
  } catch {
    return null;
  }
}

/**
 * Issue #38 (TIM-006): organization exports too large to build in the request
 * are queued here, built by the worker and downloaded by their requester
 * until the file expires. Lists the caller's recent background exports and
 * polls, with backoff, while one is still queued or running.
 */
export function TimeExportJobs({
  locale,
  offer,
  onQueued,
  onDownloaded,
}: TimeExportJobsProps) {
  const t = useTranslations("timeTracking");
  const [jobs, setJobs] = React.useState<TimeExportJob[] | null>(null);
  const [loadFailed, setLoadFailed] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<ExportErrorKey | null>(null);
  const [linked, setLinked] = React.useState<string | null>(null);
  const [attempt, setAttempt] = React.useState(0);

  const refresh = React.useCallback(async () => {
    try {
      const { items } = await getApiClient().listTimeExportJobs();
      setJobs(items);
      setLoadFailed(false);
      return items;
    } catch {
      setLoadFailed(true);
      return null;
    }
  }, []);

  React.useEffect(() => {
    const id = linkedJobId();
    setLinked(id);
    void refresh().then(async (items) => {
      // An export older than the list's newest 20 is fetched on its own.
      if (!id || !items || items.some((j) => j.exportId === id)) return;
      try {
        const job = await getApiClient().getTimeExportJob(id);
        setJobs((prev) => [...(prev ?? []), job]);
      } catch {
        // Not the caller's, or no longer accessible: nothing to highlight.
      }
    });
  }, [refresh]);

  const active = jobs?.some(isActiveExportJob) ?? false;
  React.useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => {
      void refresh().then(() => setAttempt((n) => n + 1));
    }, exportPollDelay(attempt));
    return () => clearTimeout(timer);
  }, [active, attempt, refresh]);

  const queue = async (format: "csv" | "pdf") => {
    if (!offer) return;
    setBusy(format);
    setError(null);
    try {
      const job = await getApiClient().createTimeExportJob({
        format,
        ...offer,
      });
      setJobs((prev) => [
        job,
        ...(prev ?? []).filter((j) => j.exportId !== job.exportId),
      ]);
      setAttempt(0);
      onQueued();
    } catch (err: unknown) {
      setError(exportErrorKey(err, false));
    } finally {
      setBusy(null);
    }
  };

  const download = async (job: TimeExportJob) => {
    setBusy(job.exportId);
    setError(null);
    try {
      const file = await downloadTimeExportJob({
        exportId: job.exportId,
        format: job.format,
        periodStart: job.periodStart,
        periodEnd: job.periodEnd,
      });
      saveBlob(file.blob, file.filename);
      onDownloaded(file);
    } catch (err: unknown) {
      setError(exportErrorKey(err, false));
      // The file may have expired since the list was loaded.
      void refresh();
    } finally {
      setBusy(null);
    }
  };

  return (
    <section
      aria-labelledby="export-jobs-title"
      className="space-y-4 border-t border-border pt-4"
    >
      <h2
        id="export-jobs-title"
        className="text-base font-semibold text-foreground"
      >
        {t("exportJobsTitle")}
      </h2>
      <p className="text-xs text-muted-foreground">{t("exportJobsHelp")}</p>

      {offer && (
        <div className="space-y-3 rounded-input border border-border bg-background p-3">
          <p className="text-sm text-foreground">{t("exportJobsOffer")}</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            {(["csv", "pdf"] as const).map((format) => (
              <Button
                key={format}
                type="button"
                disabled={busy !== null}
                isLoading={busy === format}
                onClick={() => void queue(format)}
                className="gap-2"
              >
                {busy !== format && (
                  <Clock className="h-4 w-4" aria-hidden="true" />
                )}
                {t(
                  format === "csv"
                    ? "exportJobsQueueCsv"
                    : "exportJobsQueuePdf",
                )}
              </Button>
            ))}
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-danger">
          {t(error)}
        </p>
      )}

      {loadFailed && (
        <p className="text-sm text-muted-foreground">
          {t("exportJobsLoadFailed")}
        </p>
      )}
      {jobs?.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("exportJobsEmpty")}</p>
      )}
      {jobs && jobs.length > 0 && (
        <ul className="divide-y divide-border rounded-input border border-border">
          {jobs.map((job) => (
            <li
              key={job.exportId}
              data-testid="export-job"
              aria-current={job.exportId === linked ? "true" : undefined}
              className={`flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between ${
                job.exportId === linked
                  ? "bg-surface ring-2 ring-focus-ring"
                  : ""
              }`}
            >
              <div className="min-w-0 space-y-1 text-sm">
                <p
                  id={`export-job-${job.exportId}`}
                  className="font-medium text-foreground"
                >
                  {t("exportJobsPeriod", {
                    start: formatCalendarDate(job.periodStart, locale),
                    end: formatCalendarDate(job.periodEnd, locale),
                    format: job.format.toUpperCase(),
                  })}
                </p>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <StatusPill
                    status={PILL[job.status].pill}
                    label={t(PILL[job.status].label)}
                  />
                  {job.status === "ready" && job.expiresAt && (
                    <span>
                      {t("exportJobsExpires", {
                        date: formatDateTime(job.expiresAt, locale),
                      })}
                    </span>
                  )}
                </div>
              </div>
              {job.status === "ready" && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy !== null}
                  isLoading={busy === job.exportId}
                  onClick={() => void download(job)}
                  aria-describedby={`export-job-${job.exportId}`}
                  className="gap-2"
                >
                  {busy !== job.exportId && (
                    <Download className="h-4 w-4" aria-hidden="true" />
                  )}
                  {t("exportJobsDownload")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
