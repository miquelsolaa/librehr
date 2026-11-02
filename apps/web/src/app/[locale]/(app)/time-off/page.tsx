"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, StatusPill, type StatusPillType } from "@librehr/ui";
import { Calendar, Plus, Users, Clock, AlertCircle } from "lucide-react";
import { getStoredSession } from "@/lib/auth";
import { getApiClient } from "@/lib/api-client";
import type { LeaveBalanceSummary, LeaveRequest } from "@librehr/contracts";

export default function TimeOffPage() {
  const params = useParams();
  const locale = (params?.["locale"] as string | undefined) ?? "ca";

  const t = useTranslations("timeOff");

  const [balance, setBalance] = React.useState<LeaveBalanceSummary | null>(
    null,
  );
  const [requests, setRequests] = React.useState<LeaveRequest[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [cancellingId, setCancellingId] = React.useState<string | null>(null);

  const fetchData = React.useCallback(async () => {
    const session = getStoredSession();
    if (!session?.token) {
      setLoading(false);
      return;
    }

    try {
      const client = getApiClient(session.token);
      const [balRes, reqsRes] = await Promise.all([
        client.getLeaveBalance().catch(() => null),
        client.listLeaveRequests().catch(() => []),
      ]);

      if (balRes) setBalance(balRes);
      if (reqsRes) setRequests(reqsRes);
    } catch {
      // Fallback
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const handleCancel = async (id: string) => {
    const session = getStoredSession();
    if (!session?.token) return;

    if (!confirm(t("confirmCancel"))) return;

    setCancellingId(id);
    try {
      const client = getApiClient(session.token);
      await client.cancelLeaveRequest(id);
      await fetchData();
    } catch {
      alert("Failed to cancel leave request");
    } finally {
      setCancellingId(null);
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
      case "cancelled":
        return "draft";
      default:
        return "draft";
    }
  };

  return (
    <div className="space-y-8">
      {/* Header with Actions */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {t("title")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>

        <div className="flex items-center gap-3">
          <Link href={`/${locale}/time-off/calendar`}>
            <Button variant="outline" className="gap-2">
              <Users className="h-4 w-4" />
              {t("teamCalendar")}
            </Button>
          </Link>

          <Link href={`/${locale}/time-off/request`}>
            <Button variant="default" className="gap-2">
              <Plus className="h-4 w-4" />
              {t("requestLeave")}
            </Button>
          </Link>
        </div>
      </div>

      {/* Balance Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-sm font-medium">{t("currentBalance")}</span>
            <Calendar className="h-4 w-4 text-primary" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold tracking-tight text-foreground">
              {loading ? "..." : (balance?.currentBalance ?? 0)}
            </span>
            <span className="text-sm text-muted-foreground">days</span>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-sm font-medium">{t("totalAccrued")}</span>
            <Clock className="h-4 w-4 text-emerald-600" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold tracking-tight text-foreground">
              {loading ? "..." : (balance?.totalAccrued ?? 0)}
            </span>
            <span className="text-sm text-muted-foreground">days</span>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-sm font-medium">{t("totalUsed")}</span>
            <AlertCircle className="h-4 w-4 text-amber-600" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold tracking-tight text-foreground">
              {loading ? "..." : (balance?.totalUsed ?? 0)}
            </span>
            <span className="text-sm text-muted-foreground">days</span>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-sm font-medium">{t("totalCarryover")}</span>
            <Clock className="h-4 w-4 text-indigo-600" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold tracking-tight text-foreground">
              {loading ? "..." : (balance?.totalCarryover ?? 0)}
            </span>
            <span className="text-sm text-muted-foreground">days</span>
          </div>
        </div>
      </div>

      {/* Requests Table */}
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-4">
        <h2 className="text-lg font-semibold text-foreground">
          {t("requestsTitle")}
        </h2>

        {requests.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            {t("noRequests")}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border text-xs font-semibold uppercase text-muted-foreground">
                <tr>
                  <th className="pb-3">{t("leaveType")}</th>
                  <th className="pb-3">{t("startDate")}</th>
                  <th className="pb-3">{t("endDate")}</th>
                  <th className="pb-3">{t("workingDays")}</th>
                  <th className="pb-3">{t("status")}</th>
                  <th className="pb-3 text-right">{t("actions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {requests.map((r) => (
                  <tr key={r.id} className="hover:bg-muted/30">
                    <td className="py-3.5 font-medium text-foreground">
                      {r.leaveTypeName || "Vacation"}
                    </td>
                    <td className="py-3.5 text-muted-foreground">
                      {r.startDate}
                    </td>
                    <td className="py-3.5 text-muted-foreground">
                      {r.endDate}
                    </td>
                    <td className="py-3.5 font-semibold text-foreground">
                      {r.workingDays}
                    </td>
                    <td className="py-3.5">
                      <StatusPill
                        status={mapStatusToPill(r.status)}
                        label={r.status}
                      />
                    </td>
                    <td className="py-3.5 text-right">
                      {(r.status === "pending" || r.status === "approved") && (
                        <button
                          type="button"
                          disabled={cancellingId === r.id}
                          onClick={() => void handleCancel(r.id)}
                          className="text-xs font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
                        >
                          {cancellingId === r.id
                            ? "Cancelling..."
                            : t("cancel")}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
