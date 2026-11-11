"use client";

import * as React from "react";
import { Play, Square, Coffee, Clock } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button, Skeleton, cn } from "@librehr/ui";
import {
  useClockStatus,
  type ClockEventType,
} from "@/components/clock-status-provider";

const TICK_MS = 30_000;

/** Whole minutes from `iso` to now; never negative (clock skew). */
function minutesSince(iso: string, now: number): number {
  return Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
}

/** Re-renders every 30 s while `active`, so elapsed time stays current. */
function useNow(active: boolean): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}

export interface ClockWidgetProps {
  /** Called after the API accepted a clock event. */
  onClockChange?: () => void;
  /**
   * `full` is the page widget (Home, Time): status sentence, elapsed time and
   * every available action. `compact` fits the top bar: state, elapsed time
   * and only the next primary action.
   */
  density?: "full" | "compact";
}

export function ClockWidget({
  onClockChange,
  density = "full",
}: ClockWidgetProps) {
  const t = useTranslations("timeTracking");
  const locale = useLocale();
  const { status, lastEvent, loading, error, pending, refresh, act } =
    useClockStatus();

  const since =
    status && status !== "clocked_out" && lastEvent
      ? lastEvent.occurredAt
      : null;
  const now = useNow(since !== null);
  const compact = density === "compact";

  const handle = async (eventType: ClockEventType) => {
    if (await act(eventType)) onClockChange?.();
  };

  if (loading && status === null && error === null) {
    return (
      <div aria-busy="true" className={compact ? "h-9 w-40" : "space-y-3"}>
        <Skeleton className={compact ? "h-full w-full" : "h-5 w-48"} />
        {!compact && <Skeleton className="h-11 w-32" />}
      </div>
    );
  }

  if (status === null) {
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center gap-2 text-xs text-foreground"
      >
        <span>
          {error === "action" ? t("actionFailed") : t("statusUnavailable")}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={loading}
          onClick={() => void refresh()}
        >
          {t("retry")}
        </Button>
      </div>
    );
  }

  const time = since
    ? new Intl.DateTimeFormat(locale, {
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(since))
    : null;
  const elapsedMinutes = since ? minutesSince(since, now) : null;
  const elapsed =
    elapsedMinutes === null
      ? null
      : t("elapsed", {
          hours: Math.floor(elapsedMinutes / 60),
          minutes: elapsedMinutes % 60,
        });

  const sentence =
    status === "clocked_in" && time
      ? t("workingSince", { time })
      : status === "on_break" && time
        ? t("onBreakSince", { time })
        : status === "clocked_in"
          ? t("statusClockedIn")
          : status === "on_break"
            ? t("statusOnBreak")
            : t("notClockedIn");
  const shortLabel =
    status === "clocked_in"
      ? t("statusClockedIn")
      : status === "on_break"
        ? t("statusOnBreak")
        : t("notClockedIn");

  const actionClass = compact ? "min-h-9 gap-1.5" : "min-h-11 gap-1.5";
  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      {status === "clocked_out" && (
        <Button
          size="sm"
          disabled={pending}
          onClick={() => void handle("clock_in")}
          className={actionClass}
        >
          <Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
          <span>{t("clockIn")}</span>
        </Button>
      )}
      {status === "clocked_in" && !compact && (
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => void handle("break_start")}
          className={actionClass}
        >
          <Coffee className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{t("startBreak")}</span>
        </Button>
      )}
      {status === "clocked_in" && (
        // Ending a shift is routine, not destructive: no danger styling.
        <Button
          variant="secondary"
          size="sm"
          disabled={pending}
          onClick={() => void handle("clock_out")}
          className={actionClass}
        >
          <Square className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
          <span>{t("clockOut")}</span>
        </Button>
      )}
      {status === "on_break" && (
        <Button
          size="sm"
          disabled={pending}
          onClick={() => void handle("break_end")}
          className={actionClass}
        >
          <Clock className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{t("endBreak")}</span>
        </Button>
      )}
    </div>
  );

  // State is carried by text; the dot only reinforces it (DESIGN.md §1.2).
  const dot = (
    <span
      aria-hidden="true"
      className={cn(
        "h-2 w-2 shrink-0 rounded-full",
        status === "clocked_in"
          ? "bg-success"
          : status === "on_break"
            ? "bg-warning"
            : "bg-muted-foreground/50",
      )}
    />
  );

  if (compact) {
    return (
      <div className="flex items-center gap-3" aria-busy={pending}>
        <div className="flex items-center gap-2 text-xs">
          {dot}
          {/* Announced when the state changes, not on every tick. */}
          <span role="status" className="font-medium text-foreground">
            {shortLabel}
          </span>
          {elapsed && (
            <span className="tabular-nums text-muted-foreground">
              {elapsed}
            </span>
          )}
        </div>
        {actions}
      </div>
    );
  }

  return (
    <div className="space-y-3" aria-busy={pending}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="flex items-center gap-2 text-sm font-medium text-foreground">
          {dot}
          <span role="status">{sentence}</span>
        </p>
        {elapsed && (
          <p className="text-sm tabular-nums text-muted-foreground">
            {elapsed}
          </p>
        )}
      </div>
      {actions}
    </div>
  );
}
