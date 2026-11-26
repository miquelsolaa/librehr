"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import type { EmploymentPeriod } from "@librehr/contracts";
import { Button, Input } from "@librehr/ui";
import { apiClient } from "@/lib/api-client";
import { getStoredSession } from "@/lib/auth";
import { currentMonthRange } from "@/lib/time-export";

/**
 * Weekly contract hours typed by an admin (LEA-002, #131): "" means the
 * default (40), a decimal comma is accepted, and anything that is not
 * > 0, <= 40 with at most two decimals is invalid (NaN).
 */
function parseWeeklyHours(raw: string): number | null {
  const trimmed = raw.trim().replace(",", ".");
  if (trimmed === "") return null;
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(trimmed)) return Number.NaN;
  const hours = Number(trimmed);
  return hours > 0 &&
    hours <= 40 &&
    // At most two decimals (numeric(5,2)), tolerant of float noise.
    Math.abs(Math.round(hours * 100) - hours * 100) < 1e-6
    ? hours
    : Number.NaN;
}

export function EmploymentHistory({
  employeeId,
  onPeriodAdded,
}: {
  employeeId: string;
  /** Called after a period is saved, so the profile can re-read its data. */
  onPeriodAdded?: () => void;
}) {
  const t = useTranslations("people.profile");
  const [periods, setPeriods] = React.useState<EmploymentPeriod[] | null>(null);
  const [loadError, setLoadError] = React.useState(false);
  const [error, setError] = React.useState<
    "historySaveError" | "historyHoursInvalid" | null
  >(null);
  const [saving, setSaving] = React.useState(false);
  const [canEdit, setCanEdit] = React.useState(false);
  const [jobTitle, setJobTitle] = React.useState("");
  const [employmentType, setEmploymentType] = React.useState("");
  const [hours, setHours] = React.useState("");
  const [startDate, setStartDate] = React.useState("");
  const [endDate, setEndDate] = React.useState("");
  const fieldId = React.useId();

  React.useEffect(() => {
    let active = true;
    setCanEdit(getStoredSession()?.role === "admin");
    setPeriods(null);
    setLoadError(false);
    void apiClient
      .listEmploymentHistory(employeeId)
      .then((data) => {
        if (active) setPeriods(data);
      })
      .catch(() => {
        if (active) setLoadError(true);
      });
    return () => {
      active = false;
    };
  }, [employeeId]);

  // A start before this month may fall in months already accrued.
  const backdated =
    startDate !== "" && startDate < currentMonthRange().startDate;
  const hoursInvalid = error === "historyHoursInvalid";

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // noValidate keeps the hours check in the page; the browser still
    // reports the required fields.
    if (!event.currentTarget.reportValidity()) return;
    const workingHoursPerWeek = parseWeeklyHours(hours);
    if (Number.isNaN(workingHoursPerWeek)) {
      setError("historyHoursInvalid");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const period = await apiClient.createEmploymentPeriod(employeeId, {
        jobTitle,
        employmentType,
        ...(workingHoursPerWeek === null ? {} : { workingHoursPerWeek }),
        startDate,
        endDate: endDate || null,
      });
      // Re-read: the new period may have closed the current one (#131).
      const refreshed = await apiClient
        .listEmploymentHistory(employeeId)
        .catch(() => null);
      setPeriods(
        (current) =>
          refreshed ??
          [period, ...(current ?? [])].sort((a, b) =>
            b.startDate.localeCompare(a.startDate),
          ),
      );
      onPeriodAdded?.();
      setJobTitle("");
      setEmploymentType("");
      setHours("");
      setStartDate("");
      setEndDate("");
    } catch (cause) {
      // The other fields are checked above, so a 400 is about the hours.
      const status = (cause as { status?: unknown } | null)?.status;
      setError(
        status === 400 && workingHoursPerWeek !== null
          ? "historyHoursInvalid"
          : "historySaveError",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      className="rounded-card border border-border bg-surface p-6 space-y-4"
      aria-labelledby="employment-history-title"
    >
      <h2
        id="employment-history-title"
        className="text-base font-semibold text-foreground"
      >
        {t("historyTitle")}
      </h2>
      {loadError ? (
        <p role="alert" className="text-sm text-danger">
          {t("historyLoadError")}
        </p>
      ) : periods === null ? (
        <p>{t("historyLoading")}</p>
      ) : periods.length === 0 ? (
        <p>{t("historyEmpty")}</p>
      ) : (
        <ul className="space-y-2">
          {periods.map((period) => (
            <li key={period.id}>
              <span className="font-medium">{period.jobTitle}</span> ·{" "}
              {period.employmentType} ·{" "}
              {t("historyHoursValue", { hours: period.workingHoursPerWeek })}
              <br />
              <span className="text-sm text-muted-foreground">
                {period.startDate} – {period.endDate ?? t("historyCurrent")}
              </span>
            </li>
          ))}
        </ul>
      )}
      {canEdit && !loadError && periods !== null && (
        <form onSubmit={submit} noValidate className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {t("historyLimitation")}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label>
              {t("historyJobTitle")}
              <Input
                required
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
              />
            </label>
            <label>
              {t("historyEmploymentType")}
              <Input
                required
                value={employmentType}
                onChange={(e) => setEmploymentType(e.target.value)}
              />
            </label>
            <div>
              <label htmlFor={`${fieldId}-hours`}>
                {t("historyWeeklyHours")}
              </label>
              <Input
                id={`${fieldId}-hours`}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={hours}
                onChange={(e) => {
                  setHours(e.target.value);
                  if (hoursInvalid) setError(null);
                }}
                aria-invalid={hoursInvalid || undefined}
                aria-describedby={
                  hoursInvalid
                    ? `${fieldId}-hours-hint ${fieldId}-hours-error`
                    : `${fieldId}-hours-hint`
                }
              />
              <p
                id={`${fieldId}-hours-hint`}
                className="text-xs text-muted-foreground"
              >
                {t("historyFullTimeHint")}
              </p>
              {hoursInvalid && (
                <p
                  id={`${fieldId}-hours-error`}
                  role="alert"
                  className="text-sm text-danger"
                >
                  {t("historyHoursInvalid")}
                </p>
              )}
            </div>
            <div>
              <label htmlFor={`${fieldId}-start`}>
                {t("historyStartDate")}
              </label>
              <Input
                id={`${fieldId}-start`}
                required
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                aria-describedby={
                  backdated ? `${fieldId}-backdated` : undefined
                }
              />
              {backdated && (
                <p
                  id={`${fieldId}-backdated`}
                  role="status"
                  className="text-xs text-warning"
                >
                  {t("historyBackdatedWarning")}
                </p>
              )}
            </div>
            <label>
              {t("historyEndDate")}
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </label>
          </div>
          {error === "historySaveError" && (
            <p role="alert" className="text-sm text-danger">
              {t("historySaveError")}
            </p>
          )}
          <Button type="submit" disabled={saving}>
            {t("historyAdd")}
          </Button>
        </form>
      )}
    </section>
  );
}
