"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, PageHeader } from "@librehr/ui";
import {
  Users,
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { getStoredSession } from "@/lib/auth";
import { getApiClient } from "@/lib/api-client";
import type { Department, OrgGroup, TeamAbsence } from "@librehr/contracts";

export default function TeamCalendarPage() {
  const params = useParams();
  const locale = (params?.["locale"] as string | undefined) ?? "ca";

  const t = useTranslations("timeOff");
  const tNav = useTranslations("nav");

  const [absences, setAbsences] = React.useState<TeamAbsence[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [currentMonth, setCurrentMonth] = React.useState(new Date());
  // ORG-007: "department:<id>" or "group:<id>"; empty shows everyone.
  const [filter, setFilter] = React.useState("");
  const [departments, setDepartments] = React.useState<Department[]>([]);
  const [groups, setGroups] = React.useState<OrgGroup[]>([]);
  const [filtersError, setFiltersError] = React.useState(false);

  const fetchFilters = React.useCallback(() => {
    if (!getStoredSession()) return;
    setFiltersError(false);
    const client = getApiClient();
    void Promise.all([client.listDepartments(), client.listOrgGroups()])
      .then(([depts, list]) => {
        setDepartments(depts);
        setGroups(list);
      })
      .catch(() => setFiltersError(true));
  }, []);
  React.useEffect(() => {
    fetchFilters();
  }, [fetchFilters]);

  const fetchAbsences = React.useCallback(async () => {
    const session = getStoredSession();
    if (!session) {
      setLoading(false);
      return;
    }

    try {
      const startOfMonth = new Date(
        currentMonth.getFullYear(),
        currentMonth.getMonth(),
        1,
      )
        .toISOString()
        .slice(0, 10);

      const endOfMonth = new Date(
        currentMonth.getFullYear(),
        currentMonth.getMonth() + 1,
        0,
      )
        .toISOString()
        .slice(0, 10);

      const client = getApiClient();
      const [kind, id] = filter.split(":");
      const res = await client.listTeamAbsences({
        startDate: startOfMonth,
        endDate: endOfMonth,
        ...(kind === "department" && id ? { departmentId: id } : {}),
        ...(kind === "group" && id ? { groupId: id } : {}),
      });

      setAbsences(res);
    } catch {
      // Fallback
    } finally {
      setLoading(false);
    }
  }, [currentMonth, filter]);

  React.useEffect(() => {
    void fetchAbsences();
  }, [fetchAbsences]);

  const prevMonth = () => {
    setCurrentMonth(
      new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1),
    );
  };

  const nextMonth = () => {
    setCurrentMonth(
      new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1),
    );
  };

  const monthName = currentMonth.toLocaleDateString(locale, {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={
          <Link
            href={`/${locale}/time-off`}
            className="inline-flex items-center gap-1 rounded-input text-muted-foreground hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            {tNav("timeOff")}
          </Link>
        }
        title={t("calendarTitle")}
        description={t("calendarSubtitle")}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={prevMonth}
              className="p-2"
              aria-label={t("previousMonth")}
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </Button>
            <span
              aria-live="polite"
              className="min-w-36 text-center text-sm font-semibold capitalize text-foreground"
            >
              {monthName}
            </span>
            <Button
              variant="outline"
              onClick={nextMonth}
              className="p-2"
              aria-label={t("nextMonth")}
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <label
          htmlFor="calendar-filter"
          className="text-sm font-medium text-foreground"
        >
          {t("calendarFilterLabel")}
        </label>
        <select
          id="calendar-filter"
          className="h-10 rounded-input border border-border bg-background px-3 text-sm text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="">{t("calendarFilterEveryone")}</option>
          {departments.length > 0 && (
            <optgroup label={t("calendarFilterDepartments")}>
              {departments.map((d) => (
                <option key={d.id} value={`department:${d.id}`}>
                  {d.name}
                </option>
              ))}
            </optgroup>
          )}
          {(["project", "area"] as const).map((kind) => {
            const ofKind = groups.filter((g) => g.kind === kind);
            return ofKind.length === 0 ? null : (
              <optgroup
                key={kind}
                label={
                  kind === "project"
                    ? t("calendarFilterProjects")
                    : t("calendarFilterAreas")
                }
              >
                {ofKind.map((g) => (
                  <option key={g.id} value={`group:${g.id}`}>
                    {g.name}
                  </option>
                ))}
              </optgroup>
            );
          })}
        </select>
        {filtersError && (
          <span role="status" className="text-sm text-muted-foreground">
            {t("calendarFiltersError")}{" "}
            <button
              type="button"
              className="text-primary underline"
              onClick={fetchFilters}
            >
              {t("calendarFiltersRetry")}
            </button>
          </span>
        )}
      </div>

      <div className="rounded-card border border-border bg-surface p-6 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-border">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Users className="h-4 w-4 text-primary" aria-hidden="true" />
            {t("scheduledAbsences", { count: absences.length })}
          </div>
          <div className="text-xs text-muted-foreground">
            {t("calendarPrivacyNotice")}
          </div>
        </div>

        {loading ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            {t("loadingCalendar")}
          </div>
        ) : absences.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            {t("noAbsencesMonth")}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {absences.map((a) => (
              <div
                key={a.requestId}
                className="flex items-center justify-between py-3 hover:bg-surface px-2 rounded-lg"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                    {a.employeeName.slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      {a.employeeName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {a.departmentName || t("noDepartment")}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <span className="rounded-full bg-surface px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                    {a.leaveTypeName}
                  </span>
                  <div className="text-right text-xs text-muted-foreground">
                    <div className="flex items-center gap-1 font-medium text-foreground">
                      <CalendarIcon className="h-3 w-3" aria-hidden="true" />
                      {a.startDate !== a.endDate
                        ? t("dateRange", { start: a.startDate, end: a.endDate })
                        : a.startDate}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
