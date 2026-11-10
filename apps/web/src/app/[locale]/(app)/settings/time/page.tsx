"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Input, PageHeader } from "@librehr/ui";
import {
  CreateScheduleAssignmentSchema,
  type EmployeeListItem,
} from "@librehr/contracts";
import { apiClient } from "@/lib/api-client";

import { ChevronLeft } from "lucide-react";
const dayKeys = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

export default function ScheduleSettingsPage() {
  const t = useTranslations("scheduleSettings");
  const tNav = useTranslations("nav");
  const locale = String(useParams()?.["locale"] ?? "ca");
  const [employees, setEmployees] = React.useState<EmployeeListItem[]>([]);
  const [search, setSearch] = React.useState("");
  const [employeeId, setEmployeeId] = React.useState("");
  const [name, setName] = React.useState("");
  const [effectiveFrom, setEffectiveFrom] = React.useState("");
  const [rest, setRest] = React.useState("");
  const [hours, setHours] = React.useState<string[]>(() =>
    dayKeys.map(() => ""),
  );
  const [breaks, setBreaks] = React.useState<string[]>(() =>
    dayKeys.map(() => ""),
  );
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<
    "invalid" | "saveError" | "overlap" | null
  >(null);
  const [saved, setSaved] = React.useState(false);
  const sequence = React.useRef(0);

  const loadEmployees = React.useCallback(async () => {
    const request = ++sequence.current;
    setLoading(true);
    setLoadError(false);
    try {
      const response = await apiClient.listEmployees({
        pageSize: 100,
        ...(search.trim() ? { search: search.trim() } : {}),
      });
      if (request === sequence.current) setEmployees(response.items);
    } catch {
      if (request === sequence.current) {
        setEmployees([]);
        setLoadError(true);
      }
    } finally {
      if (request === sequence.current) setLoading(false);
    }
  }, [search]);
  React.useEffect(() => {
    void loadEmployees();
    return () => {
      sequence.current++;
    };
  }, [loadEmployees]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    if (
      rest.trim() === "" ||
      hours.some((item) => item.trim() === "") ||
      breaks.some((item) => item.trim() === "")
    ) {
      setError("invalid");
      return;
    }
    const parsed = CreateScheduleAssignmentSchema.safeParse({
      employeeId,
      name,
      effectiveFrom,
      minimumDailyRestHours: Number(rest),
      rules: dayKeys.map((_, index) => ({
        dayOfWeek: index + 1,
        expectedHours: Number(hours[index]),
        breakMinutes: Number(breaks[index]),
      })),
    });
    if (!parsed.success) {
      setError("invalid");
      return;
    }
    setSaving(true);
    try {
      await apiClient.createScheduleAssignment(parsed.data);
      setSaved(true);
    } catch (err: unknown) {
      setError(
        typeof err === "object" &&
          err !== null &&
          "code" in err &&
          err.code === "SCHEDULE_OVERLAP"
          ? "overlap"
          : "saveError",
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        breadcrumb={
          <Link
            href={`/${locale}/settings`}
            className="inline-flex items-center gap-1 rounded-input text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            {tNav("settings")}
          </Link>
        }
        title={t("title")}
        description={t("description")}
      />
      {loadError && (
        <div role="alert" className="space-y-2">
          <p>{t("loadError")}</p>
          <Button variant="outline" onClick={() => void loadEmployees()}>
            {t("retry")}
          </Button>
        </div>
      )}
      <form
        onSubmit={submit}
        className="space-y-6 rounded-card border border-border bg-surface p-5 sm:p-6"
      >
        {error && (
          <p role="alert" className="text-sm text-danger">
            {t(error)}
          </p>
        )}
        {saved && (
          <p role="status" className="text-sm text-success">
            {t("saved")}
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor="schedule-search" className="text-sm font-medium">
              {t("searchEmployee")}
            </label>
            <Input
              id="schedule-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="schedule-employee" className="text-sm font-medium">
              {t("employee")}
            </label>
            <select
              id="schedule-employee"
              required
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              disabled={loading || loadError}
              className="min-h-11 w-full rounded-input border border-border bg-background px-3 text-sm"
            >
              <option value="">{t("selectEmployee")}</option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.firstName} {employee.lastName}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor="schedule-name" className="text-sm font-medium">
              {t("name")}
            </label>
            <Input
              id="schedule-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="schedule-from" className="text-sm font-medium">
              {t("effectiveFrom")}
            </label>
            <Input
              id="schedule-from"
              type="date"
              required
              value={effectiveFrom}
              onChange={(e) => setEffectiveFrom(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="schedule-rest" className="text-sm font-medium">
              {t("rest")}
            </label>
            <Input
              id="schedule-rest"
              type="number"
              min="0"
              max="24"
              step="0.1"
              required
              value={rest}
              onChange={(e) => setRest(e.target.value)}
            />
          </div>
        </div>
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">{t("days")}</legend>
          {dayKeys.map((day, index) => (
            <div
              key={day}
              className="grid grid-cols-2 gap-3 border-t border-border pt-3"
            >
              <div className="space-y-1">
                <label htmlFor={`hours-${day}`} className="block text-sm">
                  {t("hours", { day: t(day) })}
                </label>
                <Input
                  id={`hours-${day}`}
                  type="number"
                  min="0"
                  max="24"
                  step="0.01"
                  required
                  value={hours[index] ?? ""}
                  onChange={(e) =>
                    setHours((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index ? e.target.value : item,
                      ),
                    )
                  }
                />
              </div>
              <div className="space-y-1">
                <label htmlFor={`break-${day}`} className="block text-sm">
                  {t("breakMinutes", { day: t(day) })}
                </label>
                <Input
                  id={`break-${day}`}
                  type="number"
                  min="0"
                  max="1440"
                  step="1"
                  required
                  value={breaks[index] ?? ""}
                  onChange={(e) =>
                    setBreaks((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index ? e.target.value : item,
                      ),
                    )
                  }
                />
              </div>
            </div>
          ))}
        </fieldset>
        <Button type="submit" disabled={saving || loading || loadError}>
          {saving ? t("saving") : t("submit")}
        </Button>
      </form>
    </div>
  );
}
