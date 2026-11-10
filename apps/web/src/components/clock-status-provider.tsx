"use client";

import * as React from "react";
import type { ClockStatusResponse } from "@librehr/contracts";
import { getStoredSession } from "@/lib/auth";
import { getApiClient } from "@/lib/api-client";

export type ClockEventType =
  "clock_in" | "clock_out" | "break_start" | "break_end";

export interface ClockStatusValue {
  /** `null` while unknown: loading, or after a failure until re-checked. */
  status: ClockStatusResponse["status"] | null;
  lastEvent: ClockStatusResponse["lastEvent"];
  loading: boolean;
  /** Which request failed last; cleared by a successful status check. */
  error: "status" | "action" | null;
  /** A clock action is in flight. */
  pending: boolean;
  refresh: () => Promise<void>;
  /** Records a clock event. Resolves `true` when the API accepted it. */
  act: (eventType: ClockEventType) => Promise<boolean>;
}

const ClockStatusContext = React.createContext<ClockStatusValue | null>(null);

/**
 * One clock state for the whole app shell (TIM-001). Every clock control reads
 * from here, so clocking in from one place can never leave another control
 * offering a stale action on the legal time record.
 */
export function ClockStatusProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [status, setStatus] = React.useState<ClockStatusValue["status"]>(null);
  const [lastEvent, setLastEvent] =
    React.useState<ClockStatusValue["lastEvent"]>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<ClockStatusValue["error"]>(null);
  const [pending, setPending] = React.useState(false);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      if (!getStoredSession()) throw new Error("Session unavailable");
      const res = await getApiClient().getClockStatus();
      setStatus(res.status);
      setLastEvent(res.lastEvent ?? null);
      setError(null);
    } catch {
      setStatus(null);
      setLastEvent(null);
      setError((current) => (current === "action" ? current : "status"));
    } finally {
      setLoading(false);
    }
  }, []);

  const act = React.useCallback(async (eventType: ClockEventType) => {
    if (!getStoredSession()) {
      setStatus(null);
      setError("action");
      return false;
    }
    setPending(true);
    setError(null);
    try {
      // The server sets the event source; it is never sent by the client.
      await getApiClient().clock({ eventType });
    } catch {
      // The outcome is unknown, so offer no action until the status is
      // checked again: a blind retry could record a second event.
      setStatus(null);
      setLastEvent(null);
      setError("action");
      setPending(false);
      return false;
    }
    try {
      await refreshAfterAction();
    } finally {
      setPending(false);
    }
    return true;

    async function refreshAfterAction() {
      try {
        const res = await getApiClient().getClockStatus();
        setStatus(res.status);
        setLastEvent(res.lastEvent ?? null);
      } catch {
        setStatus(null);
        setLastEvent(null);
        setError("status");
      }
    }
  }, []);

  React.useEffect(() => {
    void refresh();
    // A tab left open overnight must not offer yesterday's action.
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  const value = React.useMemo<ClockStatusValue>(
    () => ({ status, lastEvent, loading, error, pending, refresh, act }),
    [status, lastEvent, loading, error, pending, refresh, act],
  );

  return (
    <ClockStatusContext.Provider value={value}>
      {children}
    </ClockStatusContext.Provider>
  );
}

export function useClockStatus(): ClockStatusValue {
  const value = React.useContext(ClockStatusContext);
  if (!value) {
    throw new Error("useClockStatus must be used inside <ClockStatusProvider>");
  }
  return value;
}
