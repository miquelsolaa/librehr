"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  ArrowLeft,
  Calendar,
  Moon,
  Repeat,
  ArrowLeftRight,
  CheckCircle2,
  XCircle,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import {
  Button,
  ErrorState,
  Input,
  Badge,
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@librehr/ui";
import { calendarDateInZone, daysInMonth, isoDate } from "@librehr/i18n";
import { apiClient } from "@/lib/api-client";
import type {
  ShiftTemplate,
  ShiftPattern,
  ShiftAssignment,
  ShiftSwap,
  EmployeeListItem,
} from "@librehr/contracts";

export default function ShiftRosterPage() {
  const params = useParams();
  const locale = (params?.["locale"] as string) ?? "ca";
  const t = useTranslations("timeTracking");
  const tCommon = useTranslations("common");
  const tNav = useTranslations("nav");
  const tTimeOff = useTranslations("timeOff");

  const swapStatusLabel = (value: string): string => {
    switch (value) {
      case "approved":
        return tTimeOff("statusApproved");
      case "rejected":
        return tTimeOff("statusRejected");
      case "pending":
        return tTimeOff("statusPending");
      default:
        return value;
    }
  };

  // The roster opens on the current month in the organization's time zone
  // (the browser's zone until /me answers). Month is 1-indexed.
  const [initialDate] = React.useState(() =>
    calendarDateInZone(
      new Date(),
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    ),
  );
  const [currentYear, setCurrentYear] = React.useState(initialDate.year);
  const [currentMonth, setCurrentMonth] = React.useState(initialDate.month);
  const [periodReady, setPeriodReady] = React.useState(false);

  const [templates, setTemplates] = React.useState<ShiftTemplate[]>([]);
  const [patterns, setPatterns] = React.useState<ShiftPattern[]>([]);
  const [assignments, setAssignments] = React.useState<ShiftAssignment[]>([]);
  const [swaps, setSwaps] = React.useState<ShiftSwap[]>([]);
  const [employees, setEmployees] = React.useState<EmployeeListItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState(false);
  const [generateError, setGenerateError] = React.useState(false);
  const [swapError, setSwapError] = React.useState(false);
  const [decisionError, setDecisionError] = React.useState(false);

  // Dialog state: Generate Rotational Roster
  const [genOpen, setGenOpen] = React.useState(false);
  const [selectedPatternId, setSelectedPatternId] = React.useState("");
  const [anchorDate, setAnchorDate] = React.useState("");
  const [genStartDate, setGenStartDate] = React.useState("");
  const [genEndDate, setGenEndDate] = React.useState("");
  const [selectedEmpIds, setSelectedEmpIds] = React.useState<string[]>([]);
  const [generating, setGenerating] = React.useState(false);

  // Dialog state: Shift Swap Request
  const [swapOpen, setSwapOpen] = React.useState(false);
  const [targetEmpId, setTargetEmpId] = React.useState("");
  const [myShiftDate, setMyShiftDate] = React.useState("");
  const [targetShiftDate, setTargetShiftDate] = React.useState("");
  const [swapReason, setSwapReason] = React.useState("");
  const [requestingSwap, setRequestingSwap] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState<"grid" | "swaps">("grid");

  const startDateStr = isoDate(currentYear, currentMonth, 1);
  const monthLength = daysInMonth(currentYear, currentMonth);
  const endDateStr = isoDate(currentYear, currentMonth, monthLength);

  React.useEffect(() => {
    let cancelled = false;
    apiClient
      .getMe()
      .then((me) => me.organization.timezone)
      .catch(() => undefined)
      .then((timeZone) => {
        if (cancelled) return;
        const today = timeZone
          ? calendarDateInZone(new Date(), timeZone)
          : initialDate;
        setCurrentYear(today.year);
        setCurrentMonth(today.month);
        const first = isoDate(today.year, today.month, 1);
        const todayStr = isoDate(today.year, today.month, today.day);
        setAnchorDate(first);
        setGenStartDate(first);
        setGenEndDate(
          isoDate(
            today.year,
            today.month,
            daysInMonth(today.year, today.month),
          ),
        );
        setMyShiftDate(todayStr);
        setTargetShiftDate(todayStr);
        setPeriodReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [initialDate]);

  const loadData = React.useCallback(async () => {
    try {
      setLoading(true);
      setLoadError(false);
      const [tmplRes, patRes, assignRes, swapRes, empRes] = await Promise.all([
        apiClient.listShiftTemplates(),
        apiClient.listShiftPatterns(),
        apiClient.listShiftAssignments({
          startDate: startDateStr,
          endDate: endDateStr,
        }),
        apiClient.listShiftSwaps(),
        apiClient.listEmployees().then((r) => r.items),
      ]);

      setTemplates(tmplRes);
      setPatterns(patRes);
      if (patRes[0]) {
        setSelectedPatternId(patRes[0].id);
      }
      setAssignments(assignRes);
      setSwaps(swapRes);
      setEmployees(empRes);
      if (empRes.length > 0) {
        setSelectedEmpIds(empRes.map((e) => e.id));
        if (empRes[1]) setTargetEmpId(empRes[1].id);
      }
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [startDateStr, endDateStr]);

  React.useEffect(() => {
    if (periodReady) loadData();
  }, [loadData, periodReady]);

  // Handle Roster Generation
  const handleGenerateRoster = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPatternId || selectedEmpIds.length === 0) return;
    try {
      setGenerating(true);
      setGenerateError(false);
      await apiClient.generateShiftRoster({
        patternId: selectedPatternId,
        anchorDate,
        startDate: genStartDate,
        endDate: genEndDate,
        employeeIds: selectedEmpIds,
      });
      setGenOpen(false);
      loadData();
    } catch {
      setGenerateError(true);
    } finally {
      setGenerating(false);
    }
  };

  // Handle Shift Swap Request
  const handleCreateSwap = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetEmpId || !myShiftDate || !targetShiftDate) return;
    try {
      setRequestingSwap(true);
      setSwapError(false);
      await apiClient.createShiftSwap({
        targetEmployeeId: targetEmpId,
        requesterDate: myShiftDate,
        targetDate: targetShiftDate,
        reason: swapReason || undefined,
      });
      setSwapOpen(false);
      setSwapReason("");
      loadData();
    } catch {
      setSwapError(true);
    } finally {
      setRequestingSwap(false);
    }
  };

  // Handle Swap Decision
  const handleDecideSwap = async (
    id: string,
    status: "approved" | "rejected",
  ) => {
    try {
      setDecisionError(false);
      await apiClient.decideShiftSwap(id, { status });
      loadData();
    } catch {
      setDecisionError(true);
    }
  };

  // Metrics computation
  const totalAssigned = assignments.length;
  const nightShiftsCount = assignments.filter(
    (a) => a.shiftType === "night" || a.shiftCode === "N",
  ).length;
  const totalNightHours = nightShiftsCount * 8; // 8h night shift (22:00-06:00) per ET art. 36
  const pendingSwaps = swaps.filter((s) => s.status === "pending").length;

  // Build grid data: Employee -> Day (1..monthLength) -> Assignment
  const daysArray = Array.from({ length: monthLength }, (_, i) => i + 1);

  // Group assignments by employeeId and date
  const assignmentMap = new Map<string, ShiftAssignment>();
  for (const a of assignments) {
    assignmentMap.set(`${a.employeeId}_${a.date}`, a);
  }

  // Get unique employees present in roster or employee list
  const rosterEmployees =
    employees.length > 0
      ? employees
      : Array.from(new Set(assignments.map((a) => a.employeeId))).map((id) => {
          const item = assignments.find((a) => a.employeeId === id);
          return {
            id,
            firstName: item?.employeeName?.split(" ")[0] ?? t("colEmployee"),
            lastName: item?.employeeName?.split(" ").slice(1).join(" ") ?? "",
            email: "",
            departmentName: null,
            status: "active",
          } as EmployeeListItem;
        });

  const getShiftBadge = (assign?: ShiftAssignment) => {
    if (!assign || !assign.shiftCode || assign.shiftCode === "OFF") {
      return (
        <span className="inline-block w-full py-1 text-center font-mono text-[10px] text-muted-foreground/50 rounded bg-surface">
          -
        </span>
      );
    }

    if (assign.shiftCode === "M") {
      return (
        <span
          className="inline-block w-full py-1 text-center font-mono font-bold text-[10px] rounded text-amber-900 bg-amber-100 dark:bg-amber-950/70 dark:text-amber-300"
          title={t("shiftMorning")}
        >
          M
        </span>
      );
    }

    if (assign.shiftCode === "T") {
      return (
        <span
          className="inline-block w-full py-1 text-center font-mono font-bold text-[10px] rounded text-blue-900 bg-blue-100 dark:bg-blue-950/70 dark:text-blue-300"
          title={t("shiftAfternoon")}
        >
          T
        </span>
      );
    }

    if (assign.shiftCode === "N") {
      return (
        <span
          className="inline-flex items-center justify-center gap-0.5 w-full py-1 text-center font-mono font-bold text-[10px] rounded text-indigo-900 bg-indigo-100 dark:bg-indigo-950/70 dark:text-indigo-300"
          title={t("shiftNight")}
        >
          <Moon className="h-2.5 w-2.5" aria-hidden="true" />N
        </span>
      );
    }

    return (
      <span className="inline-block w-full py-1 text-center font-mono font-bold text-[10px] rounded text-primary-foreground bg-primary/80">
        {assign.shiftCode}
      </span>
    );
  };

  if (loadError) {
    return (
      <ErrorState
        title={t("shiftsLoadError")}
        description={t("shiftsLoadErrorDescription")}
        retryLabel={t("retry")}
        onRetry={() => void loadData()}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <Link
            href={`/${locale}/time`}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{tNav("time")}</span>
          </Link>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {t("shiftsTitle")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("shiftsSubtitle")}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Swap request button */}
          <Dialog open={swapOpen} onOpenChange={setSwapOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" className="gap-2">
                <ArrowLeftRight className="h-4 w-4 text-primary" />
                <span>{t("requestSwapButton")}</span>
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t("requestSwapButton")}</DialogTitle>
                <DialogDescription>
                  {t("swapDialogDescription")}
                </DialogDescription>
              </DialogHeader>

              <form onSubmit={handleCreateSwap} className="space-y-4">
                <div className="space-y-1.5">
                  <label
                    htmlFor="swap-target"
                    className="text-xs font-medium text-foreground"
                  >
                    {t("targetColleague")}
                  </label>
                  <select
                    id="swap-target"
                    className="flex h-10 w-full rounded-input border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                    value={targetEmpId}
                    onChange={(e) => setTargetEmpId(e.target.value)}
                    required
                  >
                    {employees.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.firstName} {e.lastName}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label
                      htmlFor="swap-my-date"
                      className="text-xs font-medium text-foreground"
                    >
                      {t("myShiftDate")}
                    </label>
                    <Input
                      id="swap-my-date"
                      type="date"
                      required
                      value={myShiftDate}
                      onChange={(e) => setMyShiftDate(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label
                      htmlFor="swap-target-date"
                      className="text-xs font-medium text-foreground"
                    >
                      {t("targetShiftDate")}
                    </label>
                    <Input
                      id="swap-target-date"
                      type="date"
                      required
                      value={targetShiftDate}
                      onChange={(e) => setTargetShiftDate(e.target.value)}
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="swap-reason"
                    className="text-xs font-medium text-foreground"
                  >
                    {t("swapReason")}
                  </label>
                  <Input
                    id="swap-reason"
                    placeholder={t("swapReasonPlaceholder")}
                    value={swapReason}
                    onChange={(e) => setSwapReason(e.target.value)}
                  />
                </div>

                {swapError && (
                  <p role="alert" className="text-sm text-danger">
                    {t("shiftSwapError")}
                  </p>
                )}
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setSwapOpen(false)}
                  >
                    {tCommon("cancel")}
                  </Button>
                  <Button type="submit" disabled={requestingSwap}>
                    {requestingSwap ? tCommon("loading") : tCommon("confirm")}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>

          {/* Generate continuous rotation button */}
          <Dialog open={genOpen} onOpenChange={setGenOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Repeat className="h-4 w-4" />
                <span>{t("generateRosterButton")}</span>
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>{t("generateRosterButton")}</DialogTitle>
                <DialogDescription>
                  {t("generateDialogDescription")}
                </DialogDescription>
              </DialogHeader>

              <form onSubmit={handleGenerateRoster} className="space-y-4">
                <div className="space-y-1.5">
                  <label
                    htmlFor="gen-pattern"
                    className="text-xs font-medium text-foreground"
                  >
                    {t("selectPattern")}
                  </label>
                  <select
                    id="gen-pattern"
                    className="flex h-10 w-full rounded-input border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                    value={selectedPatternId}
                    onChange={(e) => setSelectedPatternId(e.target.value)}
                    required
                  >
                    {patterns.map((p) => (
                      <option key={p.id} value={p.id}>
                        {t("patternOption", {
                          name: p.name,
                          days: p.cycleDays,
                        })}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="gen-anchor"
                    className="text-xs font-medium text-foreground"
                  >
                    {t("anchorDate")}
                  </label>
                  <Input
                    id="gen-anchor"
                    type="date"
                    required
                    value={anchorDate}
                    onChange={(e) => setAnchorDate(e.target.value)}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    {t("anchorDateHint")}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label
                      htmlFor="gen-start"
                      className="text-xs font-medium text-foreground"
                    >
                      {t("startDate")}
                    </label>
                    <Input
                      id="gen-start"
                      type="date"
                      required
                      value={genStartDate}
                      onChange={(e) => setGenStartDate(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label
                      htmlFor="gen-end"
                      className="text-xs font-medium text-foreground"
                    >
                      {t("endDate")}
                    </label>
                    <Input
                      id="gen-end"
                      type="date"
                      required
                      value={genEndDate}
                      onChange={(e) => setGenEndDate(e.target.value)}
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <span
                    id="gen-employees-label"
                    className="text-xs font-medium text-foreground"
                  >
                    {t("selectEmployees")} ({selectedEmpIds.length})
                  </span>
                  <div
                    role="group"
                    aria-labelledby="gen-employees-label"
                    className="max-h-32 overflow-y-auto rounded border border-border p-2 space-y-1 text-xs"
                  >
                    {employees.map((emp) => (
                      <label
                        key={emp.id}
                        className="flex items-center gap-2 hover:bg-surface p-1 rounded cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={selectedEmpIds.includes(emp.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedEmpIds((prev) => [...prev, emp.id]);
                            } else {
                              setSelectedEmpIds((prev) =>
                                prev.filter((id) => id !== emp.id),
                              );
                            }
                          }}
                        />
                        <span>
                          {emp.firstName} {emp.lastName}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>

                {generateError && (
                  <p role="alert" className="text-sm text-danger">
                    {t("shiftGenerateError")}
                  </p>
                )}
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setGenOpen(false)}
                  >
                    {tCommon("cancel")}
                  </Button>
                  <Button type="submit" disabled={generating}>
                    {generating ? tCommon("loading") : tCommon("confirm")}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* KPI Cards Row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium">{t("shiftsTotal")}</span>
            <Calendar className="h-4 w-4 text-primary" />
          </div>
          <div className="mt-2 text-2xl font-bold text-foreground">
            {loading ? "..." : totalAssigned}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium">{t("shiftsNightHours")}</span>
            <Moon className="h-4 w-4 text-indigo-500" />
          </div>
          <div className="mt-2 text-2xl font-bold text-indigo-600 dark:text-indigo-400">
            {loading ? "..." : `${totalNightHours}h`}
          </div>
          <span className="text-[11px] text-muted-foreground">
            {t("nightShiftsCount", { count: nightShiftsCount })}
          </span>
        </div>

        <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium">{t("shiftsRotations")}</span>
            <Repeat className="h-4 w-4 text-amber-500" />
          </div>
          <div className="mt-2 text-sm font-semibold text-foreground truncate">
            {patterns[0]?.name ?? t("noActivePattern")}
          </div>
          {patterns[0] && (
            <span className="text-[11px] text-muted-foreground">
              {t("patternCycle", { days: patterns[0].cycleDays })}
            </span>
          )}
        </div>

        <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium">
              {t("shiftsPendingSwaps")}
            </span>
            <ArrowLeftRight className="h-4 w-4 text-blue-500" />
          </div>
          <div className="mt-2 text-2xl font-bold text-foreground">
            {loading ? "..." : pendingSwaps}
          </div>
          <span className="text-[11px] text-muted-foreground">
            {t("restValidation")}
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border gap-4 text-sm font-medium">
        <button
          type="button"
          onClick={() => setActiveTab("grid")}
          className={`pb-2 transition-colors ${
            activeTab === "grid"
              ? "border-b-2 border-primary text-primary font-bold"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {t("tabRoster")}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("swaps")}
          className={`pb-2 transition-colors flex items-center gap-1.5 ${
            activeTab === "swaps"
              ? "border-b-2 border-primary text-primary font-bold"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <span>{t("tabSwaps")}</span>
          {pendingSwaps > 0 && (
            <span className="rounded-full bg-primary/20 px-1.5 py-0.2 text-[10px] font-bold text-primary">
              {pendingSwaps}
            </span>
          )}
        </button>
      </div>

      {decisionError && (
        <p role="alert" className="text-sm text-danger">
          {t("shiftDecisionError")}
        </p>
      )}
      {activeTab === "grid" ? (
        /* Shift Roster Grid Matrix */
        <div className="rounded-card border border-border bg-surface overflow-hidden shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-4 border-b border-border bg-surface gap-3">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 w-7 p-0"
                  aria-label={t("previousMonth")}
                  onClick={() => {
                    if (currentMonth === 1) {
                      setCurrentMonth(12);
                      setCurrentYear((y) => y - 1);
                    } else {
                      setCurrentMonth((m) => m - 1);
                    }
                  }}
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                </Button>
                <span className="font-semibold text-sm text-foreground px-1">
                  {new Date(currentYear, currentMonth - 1, 1).toLocaleString(
                    locale === "ca"
                      ? "ca-ES"
                      : locale === "es"
                        ? "es-ES"
                        : "en-US",
                    { month: "long", year: "numeric" },
                  )}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 w-7 p-0"
                  aria-label={t("nextMonth")}
                  onClick={() => {
                    if (currentMonth === 12) {
                      setCurrentMonth(1);
                      setCurrentYear((y) => y + 1);
                    } else {
                      setCurrentMonth((m) => m + 1);
                    }
                  }}
                >
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>

              <span className="text-xs text-muted-foreground">
                (
                {t("rosterSummary", {
                  employees: rosterEmployees.length,
                  templates: templates.length,
                })}
                )
              </span>
            </div>

            {/* Legend */}
            <div className="flex items-center gap-3 text-xs">
              <div className="flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
                <span>{t("legendMorning")}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-full bg-blue-500" />
                <span>{t("legendAfternoon")}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-full bg-indigo-500" />
                <span>{t("legendNight")}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/40" />
                <span>{t("shiftRest")}</span>
              </div>
            </div>
          </div>

          {/* Focusable so keyboard users can scroll the wide roster. */}
          <div
            className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            role="region"
            aria-label={t("tabRoster")}
            tabIndex={0}
          >
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-border bg-surface font-semibold text-muted-foreground">
                  <th className="sticky left-0 bg-surface backdrop-blur z-10 px-3 py-2 w-48 border-r border-border">
                    {t("colEmployee")}
                  </th>
                  {daysArray.map((day) => (
                    <th
                      key={day}
                      className="px-1 py-2 text-center min-w-[28px] border-r border-border/50"
                    >
                      {day}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rosterEmployees.length === 0 ? (
                  <tr>
                    <td
                      colSpan={monthLength + 1}
                      className="p-8 text-center text-muted-foreground"
                    >
                      {t("rosterEmpty", { action: t("generateRosterButton") })}
                    </td>
                  </tr>
                ) : (
                  rosterEmployees.map((emp) => (
                    <tr
                      key={emp.id}
                      className="hover:bg-surface transition-colors"
                    >
                      <td className="sticky left-0 bg-surface z-10 px-3 py-2 font-medium text-foreground truncate border-r border-border">
                        {emp.firstName} {emp.lastName}
                      </td>
                      {daysArray.map((day) => {
                        const dateStr = isoDate(currentYear, currentMonth, day);
                        const assign = assignmentMap.get(
                          `${emp.id}_${dateStr}`,
                        );
                        return (
                          <td
                            key={day}
                            className="p-1 border-r border-border/40 text-center"
                          >
                            {getShiftBadge(assign)}
                          </td>
                        );
                      })}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* Shift Swaps List */
        <div className="rounded-card border border-border bg-surface divide-y divide-border">
          {swaps.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              {t("swapsEmpty")}
            </div>
          ) : (
            swaps.map((s) => (
              <div
                key={s.id}
                className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-4 gap-3"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-foreground">
                      {s.requesterName ?? t("requesterFallback")}
                    </span>
                    <ArrowLeftRight
                      className="h-3.5 w-3.5 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <span className="font-semibold text-sm text-foreground">
                      {s.targetEmployeeName ?? t("colleagueFallback")}
                    </span>
                    <Badge
                      variant={
                        s.status === "approved"
                          ? "success"
                          : s.status === "rejected"
                            ? "danger"
                            : "warning"
                      }
                    >
                      {swapStatusLabel(s.status)}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t.rich("swapDates", {
                      requesterDate: s.requesterDate,
                      targetDate: s.targetDate,
                      b: (chunks) => (
                        <span className="font-medium text-foreground">
                          {chunks}
                        </span>
                      ),
                    })}
                  </p>
                  {s.reason && (
                    <p className="text-xs italic text-muted-foreground">
                      "{s.reason}"
                    </p>
                  )}
                </div>

                {s.status === "pending" && (
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1 text-danger hover:bg-danger/10"
                      onClick={() => handleDecideSwap(s.id, "rejected")}
                    >
                      <XCircle className="h-3.5 w-3.5" />
                      <span>{t("rejectSwap")}</span>
                    </Button>
                    <Button
                      size="sm"
                      className="gap-1 bg-success hover:bg-success/90"
                      onClick={() => handleDecideSwap(s.id, "approved")}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span>{t("approveSwap")}</span>
                    </Button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
