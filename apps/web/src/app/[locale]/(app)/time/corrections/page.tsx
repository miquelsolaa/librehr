"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Input, StatusPill, type StatusPillType } from "@librehr/ui";
import { ArrowLeft, CheckCircle2, Clock } from "lucide-react";
import { getStoredSession } from "@/lib/auth";
import { getApiClient } from "@/lib/api-client";
import type { TimeCorrectionItem } from "@librehr/contracts";

export default function TimeCorrectionsPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const locale = (params?.["locale"] as string | undefined) ?? "ca";
  const defaultDate =
    searchParams.get("date") ?? new Date().toISOString().slice(0, 10);

  const t = useTranslations("timeTracking");
  const tTimeOff = useTranslations("timeOff");

  const eventTypeLabel = (value: string): string => {
    switch (value) {
      case "clock_in":
        return t("clockIn");
      case "clock_out":
        return t("clockOut");
      case "break_start":
        return t("startBreak");
      case "break_end":
        return t("endBreak");
      default:
        return value;
    }
  };

  const statusLabel = (value: string): string => {
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

  const [corrections, setCorrections] = React.useState<TimeCorrectionItem[]>(
    [],
  );
  const [loading, setLoading] = React.useState(true);
  const [proposedType, setProposedType] = React.useState<
    "clock_in" | "clock_out" | "break_start" | "break_end"
  >("clock_out");
  const [proposedTime, setProposedTime] = React.useState(
    `${defaultDate}T18:00`,
  );
  const [reason, setReason] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const fetchCorrections = React.useCallback(async () => {
    const session = getStoredSession();
    if (!session) {
      setLoading(false);
      return;
    }

    try {
      const client = getApiClient();
      const res = await client.listTimeCorrections();
      setCorrections(res);
    } catch {
      // Fallback
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void fetchCorrections();
  }, [fetchCorrections]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const session = getStoredSession();
    if (!session) return;

    setSubmitting(true);
    try {
      const client = getApiClient();
      await client.createTimeCorrection({
        proposedEventType: proposedType,
        proposedOccurredAt: new Date(proposedTime).toISOString(),
        reason,
      });

      setReason("");
      await fetchCorrections();
    } catch {
      setError(t("correctionFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const mapStatusToPill = (status: string): StatusPillType => {
    switch (status) {
      case "approved":
        return "approved";
      case "rejected":
        return "rejected";
      case "pending":
        return "pending";
      default:
        return "draft";
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Link
          href={`/${locale}/time`}
          className="flex items-center text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="mr-1 h-4 w-4" aria-hidden="true" />
          {t("backToTime")}
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Form Card */}
        <div className="rounded-xl border border-border bg-surface p-6 shadow-sm space-y-4">
          <div className="flex items-center gap-2 border-b border-border pb-3">
            <Clock className="h-5 w-5 text-primary" />
            <h2 className="text-base font-semibold text-foreground">
              {t("proposeCorrection")}
            </h2>
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-md bg-danger/10 p-3 text-xs text-danger"
            >
              {error}
            </div>
          )}

          <form
            onSubmit={(e) => void handleSubmit(e)}
            className="space-y-4 text-sm"
          >
            <div>
              <label
                htmlFor="correction-type"
                className="block font-medium text-foreground mb-1"
              >
                {t("eventType")}
              </label>
              <select
                id="correction-type"
                value={proposedType}
                onChange={(e) =>
                  setProposedType(e.target.value as typeof proposedType)
                }
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-focus-ring"
              >
                <option value="clock_in">{t("clockIn")}</option>
                <option value="clock_out">{t("clockOut")}</option>
                <option value="break_start">{t("startBreak")}</option>
                <option value="break_end">{t("endBreak")}</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="correction-time"
                className="block font-medium text-foreground mb-1"
              >
                {t("proposedTime")}
              </label>
              <Input
                id="correction-time"
                type="datetime-local"
                value={proposedTime}
                onChange={(e) => setProposedTime(e.target.value)}
                required
              />
            </div>

            <div>
              <label
                htmlFor="correction-reason"
                className="block font-medium text-foreground mb-1"
              >
                {t("correctionReason")}
              </label>
              <textarea
                id="correction-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                required
                rows={3}
                placeholder={t("correctionReasonPlaceholder")}
                className="w-full rounded-md border border-border bg-background p-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-focus-ring"
              />
            </div>

            <Button
              type="submit"
              variant="default"
              disabled={submitting}
              className="w-full"
            >
              {submitting ? t("submitting") : t("submitCorrection")}
            </Button>
          </form>
        </div>

        {/* History Table */}
        <div className="rounded-xl border border-border bg-surface p-6 shadow-sm space-y-4 lg:col-span-2">
          <div className="flex items-center gap-2 border-b border-border pb-3">
            <CheckCircle2 className="h-5 w-5 text-primary" />
            <h2 className="text-base font-semibold text-foreground">
              {t("correctionsTitle")}
            </h2>
          </div>

          {loading ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              {t("loadingCorrections")}
            </div>
          ) : corrections.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              {t("noCorrections")}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border text-xs font-semibold uppercase text-muted-foreground">
                  <tr>
                    <th className="pb-3">{t("colType")}</th>
                    <th className="pb-3">{t("proposedTime")}</th>
                    <th className="pb-3">{t("colReason")}</th>
                    <th className="pb-3">{t("colStatus")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {corrections.map((c) => (
                    <tr key={c.id} className="hover:bg-surface">
                      <td className="py-3 font-medium text-foreground">
                        {eventTypeLabel(c.proposedEventType)}
                      </td>
                      <td className="py-3 text-muted-foreground">
                        {new Date(c.proposedOccurredAt).toLocaleString(locale)}
                      </td>
                      <td className="py-3 text-muted-foreground max-w-xs truncate">
                        {c.reason}
                      </td>
                      <td className="py-3">
                        <StatusPill
                          status={mapStatusToPill(c.status)}
                          label={statusLabel(c.status)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
