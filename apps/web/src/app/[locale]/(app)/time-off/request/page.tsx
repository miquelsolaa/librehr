"use client";

import * as React from "react";
import { useRouter, useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Input, Badge } from "@librehr/ui";
import { Calendar, ArrowLeft, AlertTriangle, Paperclip } from "lucide-react";
import Link from "next/link";
import { getStoredSession } from "@/lib/auth";
import { getApiClient } from "@/lib/api-client";
import type { LeaveType, BlackoutPeriod } from "@librehr/contracts";

export default function RequestLeavePage() {
  const router = useRouter();
  const params = useParams();
  const locale = (params?.["locale"] as string | undefined) ?? "ca";

  const t = useTranslations("timeOff");
  const tCommon = useTranslations("common");

  const [leaveTypes, setLeaveTypes] = React.useState<LeaveType[]>([]);
  const [blackouts, setBlackouts] = React.useState<BlackoutPeriod[]>([]);
  const [selectedType, setSelectedType] = React.useState("");
  const [startDate, setStartDate] = React.useState("");
  const [endDate, setEndDate] = React.useState("");
  const [halfDayStart, setHalfDayStart] = React.useState(false);
  const [halfDayEnd, setHalfDayEnd] = React.useState(false);
  const [notes, setNotes] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const session = getStoredSession();
    if (!session) return;

    const client = getApiClient();
    Promise.all([
      client.listLeaveTypes().catch(() => []),
      client.listBlackoutPeriods().catch(() => []),
    ])
      .then(([types, bo]: [LeaveType[], BlackoutPeriod[]]) => {
        setLeaveTypes(types);
        setBlackouts(bo);
        if (types.length > 0 && types[0]) {
          setSelectedType(types[0].id);
        }
      })
      .catch(() => {});
  }, []);

  const activeBlackoutConflict = React.useMemo(() => {
    if (!startDate || !endDate) return null;
    return (
      blackouts.find(
        (b) =>
          (startDate >= b.startDate && startDate <= b.endDate) ||
          (endDate >= b.startDate && endDate <= b.endDate) ||
          (startDate <= b.startDate && endDate >= b.endDate),
      ) ?? null
    );
  }, [startDate, endDate, blackouts]);

  const currentType = React.useMemo(() => {
    return leaveTypes.find((t) => t.id === selectedType);
  }, [leaveTypes, selectedType]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const session = getStoredSession();
    if (!session) return;

    if (!startDate || !endDate) {
      setError(t("validationDates"));
      return;
    }

    setSubmitting(true);
    try {
      const client = getApiClient();
      await client.createLeaveRequest({
        leaveTypeId: selectedType,
        startDate,
        endDate,
        halfDayStart,
        halfDayEnd,
        notes: notes || undefined,
      });

      router.push(`/${locale}/time-off`);
    } catch (err: unknown) {
      setError(
        typeof err === "object" &&
          err !== null &&
          "code" in err &&
          err.code === "COVERAGE_NOT_CONFIGURED"
          ? t("coverageNotConfigured")
          : typeof err === "object" &&
              err !== null &&
              "code" in err &&
              err.code === "COVERAGE_UNVERIFIABLE"
            ? t("coverageUnverifiable")
            : t("requestFailed"),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center gap-2">
        <Link
          href={`/${locale}/time-off`}
          className="flex items-center text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="mr-1 h-4 w-4" aria-hidden="true" />
          {t("backToTimeOff")}
        </Link>
      </div>

      <div className="rounded-xl border border-border bg-surface p-6 shadow-sm">
        <div className="flex items-center gap-3 border-b border-border pb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Calendar className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">
              {t("requestFormTitle")}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t("requestFormSubtitle")}
            </p>
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-400"
          >
            {error}
          </div>
        )}

        {activeBlackoutConflict && (
          <div className="mt-4 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50/80 p-3.5 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
            <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-xs uppercase tracking-wider">
                {t("blackoutTitle")}
              </p>
              <p className="mt-0.5 text-xs">
                {activeBlackoutConflict.reason} (
                {t("dateRange", {
                  start: activeBlackoutConflict.startDate,
                  end: activeBlackoutConflict.endDate,
                })}
                )
              </p>
            </div>
          </div>
        )}

        <form onSubmit={(e) => void handleSubmit(e)} className="mt-6 space-y-4">
          <div>
            <label
              htmlFor="leave-type"
              className="block text-sm font-medium text-foreground mb-1.5"
            >
              {t("leaveType")}
            </label>
            <select
              id="leave-type"
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-focus-ring"
              required
            >
              {leaveTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}{" "}
                  {type.isPaid
                    ? `(${t("paidLeave")})`
                    : `(${t("unpaidLeave")})`}
                </option>
              ))}
            </select>

            {currentType && (
              <div className="mt-2.5 rounded-lg border border-border bg-surface-raised/60 p-3 space-y-1.5 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={currentType.isPaid ? "success" : "secondary"}>
                    {currentType.isPaid ? t("paidLeave") : t("unpaidLeave")}
                  </Badge>
                  {currentType.legalReference && (
                    <Badge variant="outline" className="font-mono text-[11px]">
                      {currentType.legalReference}
                    </Badge>
                  )}
                  {currentType.requiresAttachment && (
                    <Badge variant="warning" className="gap-1 text-[11px]">
                      <Paperclip className="h-3 w-3" aria-hidden="true" />
                      {t("documentRequired")}
                    </Badge>
                  )}
                </div>
                {currentType.description && (
                  <p className="text-muted-foreground mt-1 text-[11px] leading-relaxed">
                    {currentType.description}
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="leave-start"
                className="block text-sm font-medium text-foreground mb-1.5"
              >
                {t("startDate")}
              </label>
              <Input
                id="leave-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                required
              />
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="checkbox"
                  id="halfDayStart"
                  checked={halfDayStart}
                  onChange={(e) => setHalfDayStart(e.target.checked)}
                  className="rounded border-border text-primary focus:ring-focus-ring"
                />
                <label
                  htmlFor="halfDayStart"
                  className="text-xs text-muted-foreground"
                >
                  {t("halfDayStart")}
                </label>
              </div>
            </div>

            <div>
              <label
                htmlFor="leave-end"
                className="block text-sm font-medium text-foreground mb-1.5"
              >
                {t("endDate")}
              </label>
              <Input
                id="leave-end"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                required
              />
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="checkbox"
                  id="halfDayEnd"
                  checked={halfDayEnd}
                  onChange={(e) => setHalfDayEnd(e.target.checked)}
                  className="rounded border-border text-primary focus:ring-focus-ring"
                />
                <label
                  htmlFor="halfDayEnd"
                  className="text-xs text-muted-foreground"
                >
                  {t("halfDayEnd")}
                </label>
              </div>
            </div>
          </div>

          <div>
            <label
              htmlFor="leave-notes"
              className="block text-sm font-medium text-foreground mb-1.5"
            >
              {t("notes")}
            </label>
            <textarea
              id="leave-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-border bg-background p-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-focus-ring"
              placeholder={t("notesPlaceholder")}
            />
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-border">
            <Button asChild variant="outline">
              <Link href={`/${locale}/time-off`}>{tCommon("cancel")}</Link>
            </Button>
            <Button type="submit" variant="default" disabled={submitting}>
              {submitting ? t("submitting") : t("submitRequest")}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
