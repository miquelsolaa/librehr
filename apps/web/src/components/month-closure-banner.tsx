"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Lock, AlertTriangle } from "lucide-react";
import type { TimesheetClosureInfo } from "@librehr/contracts";
import { formatDateTime } from "@/lib/format";

export interface MonthClosureBannerProps {
  closure: TimesheetClosureInfo;
  locale: string;
  formatMinutes: (minutes: number) => string;
}

/**
 * TIM-004: a closed month shows the totals frozen at closing time and every
 * time event recorded after it. Corrections are still accepted; they are
 * listed here so the difference with the snapshot is visible.
 */
export function MonthClosureBanner({
  closure,
  locale,
  formatMinutes,
}: MonthClosureBannerProps) {
  const t = useTranslations("timeTracking");
  const headingId = React.useId();
  const changes = closure.postCloseChanges;
  const totals = closure.totals;

  return (
    <section
      aria-labelledby={headingId}
      className="space-y-4 rounded-card border border-border bg-surface p-5"
    >
      <div className="flex items-start gap-3">
        <Lock
          aria-hidden="true"
          className="mt-0.5 h-5 w-5 shrink-0 text-info"
        />
        <div className="min-w-0 space-y-1">
          <h2
            id={headingId}
            className="text-base font-semibold text-foreground"
          >
            {t("closureBannerTitle", {
              date: formatDateTime(closure.closedAt, locale),
            })}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t("closureBannerDescription")}
          </p>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          [t("closureFrozenWorked"), formatMinutes(totals.totalWorkedMinutes)],
          [t("closureFrozenBreaks"), formatMinutes(totals.totalBreakMinutes)],
          [t("closureFrozenExpected"), `${totals.totalExpectedHours}h`],
          [
            t("closureFrozenOvertime"),
            formatMinutes(totals.totalOvertimeMinutes),
          ],
        ].map(([label, value]) => (
          <div key={label} className="min-w-0 rounded-lg bg-background p-3">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-1 tabular-nums text-base font-semibold text-foreground">
              {value}
            </dd>
          </div>
        ))}
      </dl>

      {changes.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("postCloseNoChanges")}
        </p>
      ) : (
        <div className="space-y-2 rounded-lg border border-warning/40 bg-warning/10 p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <AlertTriangle
              aria-hidden="true"
              className="h-4 w-4 shrink-0 text-warning"
            />
            {t("postCloseChangesTitle", { count: changes.length })}
          </h3>
          <ul className="space-y-1 text-sm text-foreground">
            {changes.map((change) => (
              <li key={change.eventId}>
                {t(
                  change.refEventId ? "postCloseCorrection" : "postCloseEntry",
                  {
                    date: formatDateTime(change.createdAt, locale),
                  },
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
