"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  CalendarDays,
  Plus,
  Users,
  ShieldAlert,
  UserCheck,
} from "lucide-react";
import { Button, StatusPill, type StatusPillType } from "@librehr/ui";
import { getStoredSession } from "@/lib/auth";
import { getApiClient } from "@/lib/api-client";
import type {
  LeaveBalanceSummary,
  LeaveRequest,
  ApprovalDelegation,
  BlackoutPeriod,
} from "@librehr/contracts";

type PageData = {
  balance: LeaveBalanceSummary;
  requests: LeaveRequest[];
  blackouts: BlackoutPeriod[] | null;
  delegations: ApprovalDelegation[] | null;
};

function pillStatus(status: string): StatusPillType {
  if (status === "approved" || status === "rejected" || status === "pending")
    return status;
  return "draft";
}

export default function TimeOffPage() {
  const params = useParams();
  const locale = (params?.["locale"] as string | undefined) ?? "ca";
  const t = useTranslations("timeOff");
  const [data, setData] = React.useState<PageData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<"session" | "load" | null>(null);
  const [cancelError, setCancelError] = React.useState(false);
  const [cancellingId, setCancellingId] = React.useState<string | null>(null);

  const fetchData = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    const session = getStoredSession();
    if (!session?.token) {
      setData(null);
      setError("session");
      setLoading(false);
      return;
    }
    try {
      const client = getApiClient(session.token);
      const [balance, requests, blackouts, delegations] = await Promise.all([
        client.getLeaveBalance(),
        client.listLeaveRequests(),
        client.listBlackoutPeriods().catch(() => null),
        client.listApprovalDelegations().catch(() => null),
      ]);
      setData({ balance, requests, blackouts, delegations });
    } catch {
      setData(null);
      setError("load");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const handleCancel = async (id: string) => {
    const session = getStoredSession();
    if (!session?.token) {
      setCancelError(true);
      return;
    }
    if (!window.confirm(t("confirmCancel"))) return;
    setCancelError(false);
    setCancellingId(id);
    try {
      await getApiClient(session.token).cancelLeaveRequest(id);
      await fetchData();
    } catch {
      setCancelError(true);
    } finally {
      setCancellingId(null);
    }
  };

  const statusLabel = (status: string) => {
    switch (status) {
      case "pending":
        return t("statusPending");
      case "approved":
        return t("statusApproved");
      case "rejected":
        return t("statusRejected");
      case "cancelled":
        return t("statusCancelled");
      default:
        return t("statusDraft");
    }
  };

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-2xl space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
            {t("title")}
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {t("subtitle")}
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button asChild variant="outline" className="min-h-11 gap-2">
            <Link href={`/${locale}/time-off/calendar`}>
              <Users aria-hidden="true" className="h-4 w-4" />
              {t("teamCalendar")}
            </Link>
          </Button>
          <Button asChild className="min-h-11 gap-2">
            <Link href={`/${locale}/time-off/request`}>
              <Plus aria-hidden="true" className="h-4 w-4" />
              {t("requestLeave")}
            </Link>
          </Button>
        </div>
      </header>

      {loading ? (
        <p
          role="status"
          className="rounded-card border border-border bg-surface p-6 text-sm text-muted-foreground"
        >
          {t("loading")}
        </p>
      ) : error ? (
        <div
          role="alert"
          className="space-y-4 rounded-card border border-border bg-surface p-6"
        >
          <p className="text-sm text-foreground">
            {error === "session" ? t("signInRequired") : t("loadError")}
          </p>
          {error === "session" ? (
            <Button asChild variant="outline">
              <Link href={`/${locale}/sign-in`}>{t("signIn")}</Link>
            </Button>
          ) : (
            <Button variant="outline" onClick={() => void fetchData()}>
              {t("retry")}
            </Button>
          )}
        </div>
      ) : (
        data && (
          <>
            <section
              aria-label={t("currentBalance")}
              className="overflow-hidden rounded-card border border-border bg-surface"
            >
              <div className="grid sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                <div className="flex items-start gap-4 bg-accent p-6 sm:p-7">
                  <div className="rounded-input bg-surface p-2.5 text-primary">
                    <CalendarDays aria-hidden="true" className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-sm font-medium text-foreground">
                      {t("currentBalance")}
                    </h2>
                    <p className="mt-2 text-4xl font-semibold tracking-tight tabular-nums text-foreground">
                      {data.balance.currentBalance}{" "}
                      <span className="text-sm font-normal text-muted-foreground">
                        {t("days")}
                      </span>
                    </p>
                  </div>
                </div>
                <dl className="grid grid-cols-3 gap-3 p-5 sm:p-7">
                  {(
                    [
                      ["totalAccrued", data.balance.totalAccrued],
                      ["totalUsed", data.balance.totalUsed],
                      ["totalCarryover", data.balance.totalCarryover],
                      ["totalAdjustments", data.balance.totalAdjustments],
                    ] as const
                  ).map(([key, value]) => (
                    <div key={key} className="min-w-0">
                      <dt className="text-xs leading-5 text-muted-foreground">
                        {t(key)}
                      </dt>
                      <dd className="mt-2 text-xl font-semibold tabular-nums text-foreground">
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            </section>

            <section
              aria-labelledby="balance-history"
              className="overflow-hidden rounded-card border border-border bg-surface"
            >
              <div className="border-b border-border px-5 py-4 sm:px-6">
                <h2
                  id="balance-history"
                  className="text-lg font-semibold text-foreground"
                >
                  {t("balanceHistory")}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t("balanceHistoryDescription")}
                </p>
              </div>
              {data.balance.entries.length === 0 ? (
                <p className="px-6 py-6 text-sm text-muted-foreground">
                  {t("noBalanceEntries")}
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {data.balance.entries.map((entry) => {
                    const label = [
                      "accrual",
                      "usage",
                      "adjustment",
                      "carryover",
                      "expiry",
                      "reversal",
                    ].includes(entry.entryType)
                      ? t(`ledger.${entry.entryType}`)
                      : entry.entryType;
                    const amount = new Intl.NumberFormat(locale, {
                      maximumFractionDigits: 2,
                    }).format(Math.abs(entry.amount));
                    return (
                      <li
                        key={entry.id}
                        className="flex flex-wrap justify-between gap-3 px-5 py-4 sm:px-6"
                      >
                        <div>
                          <p className="font-medium">{label}</p>
                          <p className="text-sm text-muted-foreground">
                            {entry.effectiveDate}
                          </p>
                          {entry.note && (
                            <p className="text-sm text-muted-foreground">
                              {entry.note}
                            </p>
                          )}
                        </div>
                        <span className="font-medium tabular-nums">
                          {entry.amount < 0 ? "−" : entry.amount > 0 ? "+" : ""}
                          {amount}{" "}
                          {entry.unit === "days"
                            ? t("days")
                            : entry.unit === "hours"
                              ? t("ledgerHours")
                              : entry.unit}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section
              aria-labelledby="leave-requests"
              className="overflow-hidden rounded-card border border-border bg-surface"
            >
              <div className="border-b border-border px-5 py-4 sm:px-6">
                <h2
                  id="leave-requests"
                  className="text-lg font-semibold text-foreground"
                >
                  {t("requestsTitle")}
                </h2>
              </div>
              {cancelError && (
                <p role="alert" className="px-6 pt-4 text-sm text-danger">
                  {t("cancelError")}
                </p>
              )}
              {data.requests.length === 0 ? (
                <p className="px-6 py-10 text-sm text-muted-foreground">
                  {t("noRequests")}
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {data.requests.map((request) => (
                    <li
                      key={request.id}
                      className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6"
                    >
                      <div className="min-w-0 space-y-1">
                        <p className="font-medium text-foreground">
                          {request.leaveTypeName ?? t("leaveType")}
                        </p>
                        <p className="text-sm text-muted-foreground tabular-nums">
                          {request.startDate} – {request.endDate}{" "}
                          <span aria-hidden="true">·</span>{" "}
                          {request.workingDays} {t("days")}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-3">
                        <StatusPill
                          status={pillStatus(request.status)}
                          label={statusLabel(request.status)}
                        />
                        {(request.status === "pending" ||
                          request.status === "approved") && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="min-h-11"
                            disabled={cancellingId !== null}
                            onClick={() => void handleCancel(request.id)}
                          >
                            {cancellingId === request.id
                              ? t("cancelling")
                              : t("cancel")}
                          </Button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {(data.blackouts === null || data.delegations === null) && (
              <p
                role="status"
                className="rounded-input border border-border bg-surface p-4 text-sm text-muted-foreground"
              >
                {t("dataIncomplete")}{" "}
                <button
                  type="button"
                  className="font-medium text-primary underline"
                  onClick={() => void fetchData()}
                >
                  {t("retry")}
                </button>
              </p>
            )}
            <div className="grid gap-4 lg:grid-cols-2">
              <section
                aria-labelledby="blackouts"
                className="rounded-card border border-border bg-surface p-5 sm:p-6"
              >
                <div className="flex items-start gap-3">
                  <ShieldAlert
                    aria-hidden="true"
                    className="mt-0.5 h-5 w-5 shrink-0 text-primary"
                  />
                  <div>
                    <h2
                      id="blackouts"
                      className="font-semibold text-foreground"
                    >
                      {t("blackoutTitle")}
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {t("blackoutSubtitle")}
                    </p>
                  </div>
                </div>
                {data.blackouts !== null &&
                  (data.blackouts.length ? (
                    <ul className="mt-4 divide-y divide-border">
                      {data.blackouts.map((bo) => (
                        <li
                          key={bo.id}
                          className="flex flex-wrap justify-between gap-2 py-3 text-sm"
                        >
                          <span>{bo.reason}</span>
                          <span className="tabular-nums text-muted-foreground">
                            {bo.startDate} – {bo.endDate}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-5 text-sm text-muted-foreground">
                      {t("noBlackouts")}
                    </p>
                  ))}
              </section>
              <section
                aria-labelledby="delegations"
                className="rounded-card border border-border bg-surface p-5 sm:p-6"
              >
                <div className="flex items-start gap-3">
                  <UserCheck
                    aria-hidden="true"
                    className="mt-0.5 h-5 w-5 shrink-0 text-primary"
                  />
                  <div>
                    <h2
                      id="delegations"
                      className="font-semibold text-foreground"
                    >
                      {t("delegationTitle")}
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {t("delegationSubtitle")}
                    </p>
                  </div>
                </div>
                {data.delegations !== null &&
                  (data.delegations.length ? (
                    <ul className="mt-4 divide-y divide-border">
                      {data.delegations.map((del) => (
                        <li key={del.id} className="space-y-1 py-3 text-sm">
                          <div className="flex flex-wrap justify-between gap-2">
                            <span>
                              {t("delegate")}: {del.delegateName ?? "—"}
                            </span>
                            <span className="tabular-nums text-muted-foreground">
                              {del.startDate} – {del.endDate}
                            </span>
                          </div>
                          {del.reason && (
                            <p className="text-muted-foreground">
                              {del.reason}
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-5 text-sm text-muted-foreground">
                      {t("noDelegations")}
                    </p>
                  ))}
              </section>
            </div>
          </>
        )
      )}
    </div>
  );
}
