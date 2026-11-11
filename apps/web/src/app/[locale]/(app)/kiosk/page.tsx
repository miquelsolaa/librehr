"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  Coffee,
  LogOut,
  LogIn,
  Delete,
  CheckCircle2,
  AlertCircle,
  Tablet,
} from "lucide-react";
import { getApiClient } from "@/lib/api-client";
import type { KioskClockResponse } from "@librehr/contracts";

export default function KioskModePage() {
  const t = useTranslations("timeTracking");

  const [currentTime, setCurrentTime] = React.useState<string>("");
  const [currentDate, setCurrentDate] = React.useState<string>("");
  const [identifier, setIdentifier] = React.useState("");
  const [pin, setPin] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [successEvent, setSuccessEvent] =
    React.useState<KioskClockResponse | null>(null);
  const [countdown, setCountdown] = React.useState<number>(0);

  // Live digital clock
  React.useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        }),
      );
      setCurrentDate(
        now.toLocaleDateString([], {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
        }),
      );
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Auto-reset countdown after successful clock event
  React.useEffect(() => {
    if (!successEvent) return;

    setCountdown(5);
    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          setSuccessEvent(null);
          setIdentifier("");
          setPin("");
          setError(null);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [successEvent]);

  const handleKeypadPress = (val: string) => {
    if (loading || successEvent) return;
    setError(null);
    if (pin.length < 8) {
      setPin((prev) => prev + val);
    }
  };

  const handleBackspace = () => {
    if (loading || successEvent) return;
    setError(null);
    setPin((prev) => prev.slice(0, -1));
  };

  const handleClear = () => {
    if (loading || successEvent) return;
    setError(null);
    setPin("");
  };

  const handleKioskClock = async (
    eventType: "clock_in" | "clock_out" | "break_start" | "break_end",
  ) => {
    if (!identifier.trim()) {
      setError(t("kioskIdentifier"));
      return;
    }
    if (pin.length < 4) {
      setError(t("kioskPinPrompt"));
      return;
    }

    setLoading(true);
    setError(null);

    const client = getApiClient();

    try {
      const res = await client.kioskClock({
        identifier: identifier.trim(),
        pin,
        eventType,
      });

      setSuccessEvent(res);
    } catch {
      setError(t("kioskPinPrompt"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-4xl flex-col items-center justify-center p-4 sm:p-6 lg:p-8">
      {/* Header with Live Clock */}
      <div className="mb-6 flex w-full flex-col items-center text-center">
        <h1 className="inline-flex items-center gap-2 text-base font-semibold text-foreground">
          <Tablet
            className="h-4 w-4 text-muted-foreground"
            aria-hidden="true"
          />
          {t("kioskTitle")}
        </h1>
        <div className="mt-2 text-4xl font-extrabold tracking-tight sm:text-5xl">
          {currentTime || "--:--:--"}
        </div>
        <div className="mt-1 text-sm font-medium capitalize text-muted-foreground">
          {currentDate}
        </div>
      </div>

      {/* Main Terminal Card */}
      <div className="w-full max-w-lg rounded-2xl border bg-surface p-6 shadow-xl sm:p-8">
        {successEvent ? (
          /* Success Screen with Auto-reset Countdown */
          <div className="flex flex-col items-center justify-center py-8 text-center animate-in fade-in zoom-in-95 duration-200">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-success/10 text-success">
              <CheckCircle2 className="h-10 w-10" />
            </div>
            <h2 className="mt-4 text-2xl font-semibold tracking-tight text-foreground">
              {t("kioskClockSuccess", { name: successEvent.employeeName })}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {new Date(successEvent.occurredAt).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </p>
            <div className="mt-6 rounded-lg bg-surface px-4 py-2 text-xs font-medium text-muted-foreground">
              {t("kioskResetting", { seconds: countdown })}
            </div>
          </div>
        ) : (
          /* Clock-in Terminal Input & Keypad */
          <div className="space-y-6">
            {error && (
              <div
                role="alert"
                className="flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger"
              >
                <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{error}</span>
              </div>
            )}

            {/* Identifier input */}
            <div>
              <label
                htmlFor="kiosk-id"
                className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground"
              >
                {t("kioskIdentifier")}
              </label>
              <input
                id="kiosk-id"
                type="text"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder={t("kioskIdentifierPlaceholder")}
                disabled={loading}
                className="w-full rounded-xl border bg-background px-4 py-3 text-center text-lg font-medium shadow-inner outline-none transition focus:border-focus-ring focus:ring-2 focus:ring-focus-ring/30"
                autoComplete="off"
              />
            </div>

            {/* PIN Display Dots */}
            <div>
              <label className="mb-1.5 block text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t("kioskPin")}
              </label>
              <div className="flex h-12 items-center justify-center gap-3 rounded-xl border bg-surface px-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div
                    key={i}
                    className={`h-4 w-4 rounded-full transition-all duration-150 ${
                      i < pin.length
                        ? "scale-110 bg-primary"
                        : "border-2 border-muted-foreground/30 bg-background"
                    }`}
                  />
                ))}
              </div>
            </div>

            {/* Big Touch Keypad */}
            <div className="grid grid-cols-3 gap-3">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
                <button
                  key={digit}
                  type="button"
                  onClick={() => handleKeypadPress(digit)}
                  disabled={loading}
                  className="flex h-14 items-center justify-center rounded-xl border bg-background text-2xl font-bold shadow-sm transition active:scale-95 active:bg-surface hover:bg-accent"
                >
                  {digit}
                </button>
              ))}
              <button
                type="button"
                onClick={handleClear}
                disabled={loading || pin.length === 0}
                className="flex h-14 items-center justify-center rounded-xl border bg-surface text-sm font-semibold transition active:scale-95 disabled:opacity-40"
              >
                {t("kioskClear")}
              </button>
              <button
                type="button"
                onClick={() => handleKeypadPress("0")}
                disabled={loading}
                className="flex h-14 items-center justify-center rounded-xl border bg-background text-2xl font-bold shadow-sm transition active:scale-95 active:bg-surface hover:bg-accent"
              >
                0
              </button>
              <button
                type="button"
                onClick={handleBackspace}
                aria-label={t("kioskBackspace")}
                disabled={loading || pin.length === 0}
                className="flex h-14 items-center justify-center rounded-xl border bg-surface text-muted-foreground transition active:scale-95 disabled:opacity-40 hover:text-foreground"
              >
                <Delete className="h-6 w-6" aria-hidden="true" />
              </button>
            </div>

            {/* Action Clock Buttons */}
            <div className="grid grid-cols-3 gap-3 pt-2">
              <button
                type="button"
                onClick={() => handleKioskClock("clock_in")}
                disabled={loading || !identifier || pin.length < 4}
                className="flex h-14 flex-col items-center justify-center rounded-xl bg-success text-white font-semibold shadow-md transition hover:opacity-90 active:scale-95 disabled:opacity-40"
              >
                <LogIn className="h-5 w-5 mb-0.5" aria-hidden="true" />
                <span className="text-xs">{t("kioskActionIn")}</span>
              </button>
              <button
                type="button"
                onClick={() => handleKioskClock("break_start")}
                disabled={loading || !identifier || pin.length < 4}
                className="flex h-14 flex-col items-center justify-center rounded-xl bg-warning text-white font-semibold shadow-md transition hover:opacity-90 active:scale-95 disabled:opacity-40"
              >
                <Coffee className="h-5 w-5 mb-0.5" aria-hidden="true" />
                <span className="text-xs">{t("kioskActionBreak")}</span>
              </button>
              <button
                type="button"
                onClick={() => handleKioskClock("clock_out")}
                disabled={loading || !identifier || pin.length < 4}
                className="flex h-14 flex-col items-center justify-center rounded-xl bg-danger text-white font-semibold shadow-md transition hover:opacity-90 active:scale-95 disabled:opacity-40"
              >
                <LogOut className="h-5 w-5 mb-0.5" aria-hidden="true" />
                <span className="text-xs">{t("kioskActionOut")}</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
