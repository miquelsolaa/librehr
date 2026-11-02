"use client";

import * as React from "react";
import { useRouter, useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Input } from "@librehr/ui";
import { Calendar, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { getStoredSession } from "@/lib/auth";
import { getApiClient } from "@/lib/api-client";
import type { LeaveType } from "@librehr/contracts";

export default function RequestLeavePage() {
  const router = useRouter();
  const params = useParams();
  const locale = (params?.["locale"] as string | undefined) ?? "ca";

  const t = useTranslations("timeOff");

  const [leaveTypes, setLeaveTypes] = React.useState<LeaveType[]>([]);
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
    if (!session?.token) return;

    const client = getApiClient(session.token);
    client
      .listLeaveTypes()
      .then((types: LeaveType[]) => {
        setLeaveTypes(types);
        if (types.length > 0 && types[0]) {
          setSelectedType(types[0].id);
        }
      })
      .catch(() => {});
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const session = getStoredSession();
    if (!session?.token) return;

    if (!startDate || !endDate) {
      setError("Please select both start and end dates.");
      return;
    }

    setSubmitting(true);
    try {
      const client = getApiClient(session.token);
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
        err instanceof Error ? err.message : "Failed to submit leave request.",
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
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back to Time Off
        </Link>
      </div>

      <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="flex items-center gap-3 border-b border-border pb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Calendar className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">
              {t("requestFormTitle")}
            </h1>
            <p className="text-sm text-muted-foreground">
              Submit your dates for manager approval.
            </p>
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-400">
            {error}
          </div>
        )}

        <form onSubmit={(e) => void handleSubmit(e)} className="mt-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              {t("leaveType")}
            </label>
            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              required
            >
              {leaveTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name} {type.isPaid ? "(Paid)" : "(Unpaid)"}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                {t("startDate")}
              </label>
              <Input
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
                  className="rounded border-input text-primary focus:ring-ring"
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
              <label className="block text-sm font-medium text-foreground mb-1.5">
                {t("endDate")}
              </label>
              <Input
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
                  className="rounded border-input text-primary focus:ring-ring"
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
            <label className="block text-sm font-medium text-foreground mb-1.5">
              {t("notes")}
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-input bg-background p-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="Provide context or coverage arrangements..."
            />
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-border">
            <Link href={`/${locale}/time-off`}>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </Link>
            <Button type="submit" variant="default" disabled={submitting}>
              {submitting ? "Submitting..." : t("submitRequest")}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
