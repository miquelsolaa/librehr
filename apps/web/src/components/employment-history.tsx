"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import type { EmploymentPeriod } from "@librehr/contracts";
import { Button, Input } from "@librehr/ui";
import { apiClient } from "@/lib/api-client";
import { getStoredSession } from "@/lib/auth";

export function EmploymentHistory({ employeeId }: { employeeId: string }) {
  const t = useTranslations("people.profile");
  const [periods, setPeriods] = React.useState<EmploymentPeriod[] | null>(null);
  const [loadError, setLoadError] = React.useState(false);
  const [saveError, setSaveError] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [canEdit, setCanEdit] = React.useState(false);
  const [jobTitle, setJobTitle] = React.useState("");
  const [employmentType, setEmploymentType] = React.useState("");
  const [startDate, setStartDate] = React.useState("");
  const [endDate, setEndDate] = React.useState("");

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

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setSaveError(false);
    try {
      const period = await apiClient.createEmploymentPeriod(employeeId, {
        jobTitle,
        employmentType,
        startDate,
        endDate: endDate || null,
      });
      setPeriods((current) =>
        [period, ...(current ?? [])].sort((a, b) =>
          b.startDate.localeCompare(a.startDate),
        ),
      );
      setJobTitle("");
      setEmploymentType("");
      setStartDate("");
      setEndDate("");
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      className="rounded-card border border-border bg-surface p-6 space-y-4"
      aria-labelledby="employment-history-title"
    >
      <h2 id="employment-history-title" className="text-base font-semibold">
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
              {period.employmentType}
              <br />
              <span className="text-sm text-muted-foreground">
                {period.startDate} – {period.endDate ?? t("historyCurrent")}
              </span>
            </li>
          ))}
        </ul>
      )}
      {canEdit && !loadError && periods !== null && (
        <form onSubmit={submit} className="space-y-3">
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
            <label>
              {t("historyStartDate")}
              <Input
                required
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </label>
            <label>
              {t("historyEndDate")}
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </label>
          </div>
          {saveError && (
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
