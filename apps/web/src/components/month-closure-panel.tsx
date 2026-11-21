"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Button, StatusPill } from "@librehr/ui";
import type {
  CloseTimesheetPeriodResponse,
  TimesheetClosureItem,
} from "@librehr/contracts";
import { getApiClient } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { ReopenMonthDialog } from "@/components/reopen-month-dialog";

export interface MonthClosurePanelProps {
  /** `YYYY-MM`. */
  month: string;
  /** The month as people read it, e.g. "January 2026". */
  monthLabel: string;
  /** Only an ended month can be closed (the API answers 422 otherwise). */
  monthEnded: boolean;
  locale: string;
  /** Called after a close or reopen, so the page reloads its timesheet. */
  onChanged: () => void;
}

/**
 * TIM-004: administrators close a month for every employee (a snapshot of
 * their totals) and reopen one employee's month with a reason. Shown only to
 * admins; the API enforces `time.period.close` either way.
 */
export function MonthClosurePanel({
  month,
  monthLabel,
  monthEnded,
  locale,
  onChanged,
}: MonthClosurePanelProps) {
  const t = useTranslations("timeTracking");
  const headingId = React.useId();
  const [items, setItems] = React.useState<TimesheetClosureItem[] | null>(null);
  const [loadFailed, setLoadFailed] = React.useState(false);
  const [closing, setClosing] = React.useState(false);
  const [closeResult, setCloseResult] =
    React.useState<CloseTimesheetPeriodResponse | null>(null);
  const [closeFailed, setCloseFailed] = React.useState(false);
  const [reopening, setReopening] = React.useState<TimesheetClosureItem | null>(
    null,
  );
  const [reopenSubmitting, setReopenSubmitting] = React.useState(false);
  const [reopenFailed, setReopenFailed] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoadFailed(false);
    try {
      const res = await getApiClient().listTimesheetClosures({ month });
      setItems(res.items);
    } catch {
      setItems(null);
      setLoadFailed(true);
    }
  }, [month]);

  React.useEffect(() => {
    setCloseResult(null);
    setCloseFailed(false);
    void load();
  }, [load]);

  const closeMonth = async () => {
    setClosing(true);
    setCloseFailed(false);
    setCloseResult(null);
    try {
      setCloseResult(await getApiClient().closeTimesheetPeriod({ month }));
      await load();
      onChanged();
    } catch {
      setCloseFailed(true);
    } finally {
      setClosing(false);
    }
  };

  const reopen = async (reason: string) => {
    if (!reopening) return;
    setReopenSubmitting(true);
    setReopenFailed(false);
    try {
      await getApiClient().reopenTimesheetPeriod({
        month,
        employeeId: reopening.employeeId,
        reason,
      });
      setReopening(null);
      await load();
      onChanged();
    } catch {
      setReopenFailed(true);
    } finally {
      setReopenSubmitting(false);
    }
  };

  const count = (status: string) =>
    closeResult?.results.filter((r) => r.status === status).length ?? 0;

  return (
    <section
      aria-labelledby={headingId}
      className="space-y-4 rounded-card border border-border bg-surface p-5"
    >
      <div className="space-y-1">
        <h2 id={headingId} className="text-base font-semibold text-foreground">
          {t("closurePanelTitle")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t("closurePanelDescription")}
        </p>
      </div>

      {monthEnded ? (
        <Button
          onClick={() => void closeMonth()}
          disabled={closing}
          className="min-h-11 max-w-full whitespace-normal"
        >
          {closing
            ? t("closingMonth")
            : t("closeMonthButton", { month: monthLabel })}
        </Button>
      ) : (
        <p className="text-sm text-muted-foreground">
          {t("closeMonthNotEnded")}
        </p>
      )}

      <div aria-live="polite">
        {closeResult && (
          <p role="status" className="text-sm text-foreground">
            {t("closeResult", {
              closed: count("closed"),
              already: count("already_closed"),
              missing: count("schedule_not_configured"),
            })}
          </p>
        )}
      </div>
      {closeFailed && (
        <p role="alert" className="text-sm text-danger">
          {t("closeFailed")}
        </p>
      )}

      {loadFailed ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3"
        >
          <p className="text-sm text-foreground">{t("closuresLoadFailed")}</p>
          <Button variant="outline" onClick={() => void load()}>
            {t("retry")}
          </Button>
        </div>
      ) : items === null ? null : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("closuresEmpty")}</p>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((item) => (
            <li
              key={item.employeeId}
              className="flex flex-wrap items-center justify-between gap-3 py-3"
            >
              <div className="min-w-0 space-y-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {item.employeeName}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(item.at, locale)}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <StatusPill
                  status={item.status === "closed" ? "inactive" : "pending"}
                  label={t(
                    item.status === "closed"
                      ? "closureStatusClosed"
                      : "closureStatusReopened",
                  )}
                />
                {item.status === "closed" && (
                  <Button
                    variant="outline"
                    className="min-h-11"
                    aria-label={t("reopenFor", { name: item.employeeName })}
                    onClick={() => {
                      setReopenFailed(false);
                      setReopening(item);
                    }}
                  >
                    {t("reopenButton")}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <ReopenMonthDialog
        open={reopening !== null}
        subject={t("reopenSubject", {
          name: reopening?.employeeName ?? "",
          month: monthLabel,
        })}
        submitting={reopenSubmitting}
        failure={reopenFailed ? t("reopenFailed") : undefined}
        onOpenChange={(open) => {
          if (!open) setReopening(null);
        }}
        onConfirm={(reason) => void reopen(reason)}
      />
    </section>
  );
}
