"use client";

import * as React from "react";
import { Play, Square, Coffee, Clock } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@librehr/ui";
import { getStoredSession } from "@/lib/auth";
import { getApiClient } from "@/lib/api-client";
import type { ClockStatusResponse } from "@librehr/contracts";

export function ClockWidget({ onClockChange }: { onClockChange?: () => void }) {
  const t = useTranslations("timeTracking");
  const [status, setStatus] = React.useState<
    ClockStatusResponse["status"] | null
  >(null);
  const [statusLoading, setStatusLoading] = React.useState(true);
  const [actionError, setActionError] = React.useState(false);
  const [loading, setLoading] = React.useState(false);

  const fetchStatus = React.useCallback(async () => {
    setStatusLoading(true);
    const session = getStoredSession();
    try {
      if (!session?.token) throw new Error("Session unavailable");
      const client = getApiClient(session.token);
      const res = await client.getClockStatus();
      setStatus(res.status);
      setActionError(false);
    } catch {
      setStatus(null);
    } finally {
      setStatusLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  const handleAction = async (
    action: "clock_in" | "clock_out" | "break_start" | "break_end",
  ) => {
    const session = getStoredSession();
    if (!session?.token) {
      setActionError(true);
      setStatus(null);
      return;
    }

    setLoading(true);
    setActionError(false);
    try {
      const client = getApiClient(session.token);
      // The server sets the event source; it is never sent by the client.
      await client.clock({ eventType: action });
      await fetchStatus();
      onClockChange?.();
    } catch {
      setActionError(true);
      setStatus(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="flex flex-wrap items-center gap-2"
      aria-busy={loading || statusLoading}
    >
      {!statusLoading && status === null && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 text-xs text-foreground"
        >
          <span>
            {actionError ? t("actionFailed") : t("statusUnavailable")}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void fetchStatus()}
          >
            {t("retry")}
          </Button>
        </div>
      )}
      {status === "clocked_out" && (
        <Button
          variant="default"
          size="sm"
          disabled={loading}
          onClick={() => void handleAction("clock_in")}
          className="min-h-11 gap-1.5"
        >
          <Play className="h-3.5 w-3.5 fill-current" />
          <span>{t("clockIn")}</span>
        </Button>
      )}

      {status === "clocked_in" && (
        <>
          <Button
            variant="outline"
            size="sm"
            disabled={loading}
            onClick={() => void handleAction("break_start")}
            className="min-h-11 gap-1.5"
          >
            <Coffee className="h-3.5 w-3.5 text-amber-600" />
            <span>{t("startBreak")}</span>
          </Button>

          <Button
            variant="danger"
            size="sm"
            disabled={loading}
            onClick={() => void handleAction("clock_out")}
            className="min-h-11 gap-1.5"
          >
            <Square className="h-3.5 w-3.5 fill-current" />
            <span>{t("clockOut")}</span>
          </Button>
        </>
      )}

      {status === "on_break" && (
        <Button
          variant="default"
          size="sm"
          disabled={loading}
          onClick={() => void handleAction("break_end")}
          className="min-h-11 gap-1.5"
        >
          <Clock className="h-3.5 w-3.5" />
          <span>{t("endBreak")}</span>
        </Button>
      )}
    </div>
  );
}
