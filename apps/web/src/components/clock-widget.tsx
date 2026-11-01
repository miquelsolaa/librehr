"use client";

import * as React from "react";
import { Play, Square, Coffee, Clock } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@openhr/ui";
import { getStoredSession } from "@/lib/auth";
import { getApiClient } from "@/lib/api-client";
import type { ClockStatusResponse } from "@openhr/contracts";

export function ClockWidget({ onClockChange }: { onClockChange?: () => void }) {
  const t = useTranslations("timeTracking");
  const [status, setStatus] =
    React.useState<ClockStatusResponse["status"]>("clocked_out");
  const [loading, setLoading] = React.useState(false);

  const fetchStatus = React.useCallback(async () => {
    const session = getStoredSession();
    if (!session?.token) return;

    try {
      const client = getApiClient(session.token);
      const res = await client.getClockStatus();
      setStatus(res.status);
    } catch {
      // Fallback
    }
  }, []);

  React.useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  const handleAction = async (
    action: "clock_in" | "clock_out" | "break_start" | "break_end",
  ) => {
    const session = getStoredSession();
    if (!session?.token) return;

    setLoading(true);
    try {
      const client = getApiClient(session.token);
      await client.clock({
        eventType: action,
        source: "web",
      });
      await fetchStatus();
      onClockChange?.();
    } catch {
      alert("Failed to record time event");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      {status === "clocked_out" && (
        <Button
          variant="default"
          size="sm"
          disabled={loading}
          onClick={() => void handleAction("clock_in")}
          className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
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
            className="gap-1.5"
          >
            <Coffee className="h-3.5 w-3.5 text-amber-600" />
            <span>{t("startBreak")}</span>
          </Button>

          <Button
            variant="danger"
            size="sm"
            disabled={loading}
            onClick={() => void handleAction("clock_out")}
            className="gap-1.5"
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
          className="gap-1.5 bg-amber-600 hover:bg-amber-700 text-white"
        >
          <Clock className="h-3.5 w-3.5" />
          <span>{t("endBreak")}</span>
        </Button>
      )}
    </div>
  );
}
