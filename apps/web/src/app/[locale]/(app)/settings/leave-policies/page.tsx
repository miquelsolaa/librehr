"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { CalendarClock, ChevronLeft } from "lucide-react";
import { Button, PageHeader } from "@librehr/ui";
import type { LeavePolicy, LeaveType } from "@librehr/contracts";
import { LeavePolicyProrationForm } from "@/components/leave-policy-proration-form";
import { LeavePolicyCarryoverForm } from "@/components/leave-policy-carryover-form";
import { apiClient } from "@/lib/api-client";

/**
 * LEA-002: leave policies, their opt-in part-time proration (#118) and
 * their opt-in carry-over cap, forfeit and expiry (#132).
 */
export default function LeavePoliciesSettingsPage() {
  const params = useParams();
  const locale = (params?.["locale"] as string) ?? "es";
  const t = useTranslations("leavePolicies");
  const tCommon = useTranslations("common");
  const tNav = useTranslations("nav");

  const [policies, setPolicies] = React.useState<LeavePolicy[]>([]);
  const [types, setTypes] = React.useState<Map<string, LeaveType>>(new Map());
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const [list, leaveTypes] = await Promise.all([
        apiClient.listLeavePolicies(),
        apiClient.listLeaveTypes(),
      ]);
      setPolicies(list);
      setTypes(new Map(leaveTypes.map((type) => [type.id, type])));
    } catch {
      setPolicies([]);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const method = (m: LeavePolicy["accrualMethod"]) =>
    m === "upfront"
      ? t("methodUpfront")
      : m === "monthly"
        ? t("methodMonthly")
        : t("methodDaily");

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={
          <Link
            href={`/${locale}/settings`}
            className="inline-flex items-center gap-1 rounded-input text-muted-foreground hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            {tNav("settings")}
          </Link>
        }
        title={t("title")}
        description={t("description")}
      />

      <div className="rounded-card border border-border bg-surface divide-y divide-border">
        {loading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            {tCommon("loading")}
          </div>
        ) : loadError ? (
          <div role="alert" className="space-y-3 p-8 text-center text-sm">
            <p>{t("loadError")}</p>
            <Button variant="outline" onClick={() => void load()}>
              {t("retry")}
            </Button>
          </div>
        ) : policies.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            {t("empty")}
          </div>
        ) : (
          policies.map((policy) => (
            <div key={policy.id} className="p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-input bg-primary/10 text-primary">
                  <CalendarClock className="h-4 w-4" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-foreground">
                    {policy.name}
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    {t("summary", {
                      type: types.get(policy.leaveTypeId)?.name ?? "",
                      days: policy.annualAllowanceDays,
                      method: method(policy.accrualMethod),
                    })}
                  </p>
                </div>
              </div>
              <LeavePolicyProrationForm
                policy={policy}
                onSaved={(updated) =>
                  setPolicies((current) =>
                    current.map((p) => (p.id === updated.id ? updated : p)),
                  )
                }
              />
              <LeavePolicyCarryoverForm
                policy={policy}
                onSaved={(updated) =>
                  setPolicies((current) =>
                    current.map((p) => (p.id === updated.id ? updated : p)),
                  )
                }
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
