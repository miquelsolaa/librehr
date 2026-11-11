"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronLeft, Mail, Users } from "lucide-react";
import type { Auditor, AuditorListResponse } from "@librehr/contracts";
import { Button, PageHeader } from "@librehr/ui";
import { getApiClient } from "@/lib/api-client";
import { getStoredSession } from "@/lib/auth";
import { AuditorAccessList } from "@/components/auditor-access-list";
import { AuditorInviteForm } from "@/components/auditor-invite-form";
import { AuditorMaxDaysForm } from "@/components/auditor-max-days-form";
import { AuditorPendingInvitations } from "@/components/auditor-pending-invitations";

const CARD =
  "rounded-card border border-border bg-surface p-4 shadow-sm space-y-4 sm:p-6";

/** TIM-008: Settings -> Inspector access (admins only). */
export default function AuditorAccessSettingsPage() {
  const params = useParams();
  const locale = (params?.["locale"] as string | undefined) ?? "ca";
  const t = useTranslations("auditorAccess");
  const tSettings = useTranslations("settings");
  const tNav = useTranslations("nav");

  const [isAdmin, setIsAdmin] = React.useState<boolean | null>(null);
  // Kept while refreshing, so rows (and the focus inside them) stay mounted.
  const [data, setData] = React.useState<AuditorListResponse | null>(null);
  const [refreshing, setRefreshing] = React.useState(false);
  const [loadError, setLoadError] = React.useState(false);
  const [status, setStatus] = React.useState<string | null>(null);
  const auditorsHeading = React.useRef<HTMLHeadingElement>(null);
  const pendingHeading = React.useRef<HTMLHeadingElement>(null);

  const load = React.useCallback(async () => {
    setRefreshing(true);
    setLoadError(false);
    try {
      setData(await getApiClient().listAuditors());
    } catch {
      setLoadError(true);
    } finally {
      setRefreshing(false);
    }
  }, []);

  React.useEffect(() => {
    const admin = getStoredSession()?.role === "admin";
    setIsAdmin(admin);
    if (admin) void load();
  }, [load]);

  const announce = (message: string) => {
    setStatus(message);
    void load();
  };

  const handleUpdated = (auditor: Auditor, message: string) => {
    // Show the API's answer at once; the refresh only reconciles.
    setData((prev) =>
      prev
        ? {
            ...prev,
            items: prev.items.map((item) =>
              item.userId === auditor.userId ? auditor : item,
            ),
          }
        : prev,
    );
    announce(message);
  };

  const handleCancelled = (id: string, message: string) => {
    setData((prev) =>
      prev
        ? {
            ...prev,
            pendingInvitations: prev.pendingInvitations.filter(
              (invite) => invite.id !== id,
            ),
          }
        : prev,
    );
    announce(message);
  };

  const initialLoading = isAdmin === true && data === null && !loadError;

  return (
    <div className="space-y-6" aria-busy={refreshing || undefined}>
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

      {status && (
        <div
          role="status"
          className="rounded-card border border-success/30 bg-success/10 p-4 text-sm text-success"
        >
          {status}
        </div>
      )}

      {isAdmin === false && (
        <p role="alert" className="text-sm text-muted-foreground">
          {t("adminOnly")}
        </p>
      )}

      {initialLoading && (
        <div
          role="status"
          className="flex items-center gap-3 text-sm text-muted-foreground"
        >
          <span
            className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent"
            aria-hidden="true"
          />
          {t("loading")}
        </div>
      )}

      {isAdmin && loadError && (
        <div role="alert" className="space-y-3 text-sm">
          <p className="text-danger">{t("loadError")}</p>
          <Button variant="outline" onClick={() => void load()}>
            {tSettings("retry")}
          </Button>
        </div>
      )}

      {isAdmin && data && (
        <>
          <div className="grid gap-6 md:grid-cols-2">
            <AuditorInviteForm
              className={CARD}
              today={data.today}
              latestAccessUntil={data.latestAccessUntil}
              maxDays={data.auditorAccessMaxDays}
              timeZone={data.timeZone}
              onInvited={announce}
            />
            <AuditorMaxDaysForm
              className={CARD}
              maxDays={data.auditorAccessMaxDays}
              onSaved={(_days, message) => announce(message)}
            />
          </div>

          <section className="space-y-3" aria-labelledby="auditors-heading">
            <h2
              id="auditors-heading"
              ref={auditorsHeading}
              tabIndex={-1}
              className="flex items-center gap-2 text-base font-semibold text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              <Users className="h-5 w-5 text-primary" aria-hidden="true" />
              {t("listTitle")}
            </h2>
            <AuditorAccessList
              auditors={data.items}
              today={data.today}
              latestAccessUntil={data.latestAccessUntil}
              maxDays={data.auditorAccessMaxDays}
              locale={locale}
              headingRef={auditorsHeading}
              onUpdated={handleUpdated}
            />
          </section>

          <section className="space-y-3" aria-labelledby="pending-heading">
            <h2
              id="pending-heading"
              ref={pendingHeading}
              tabIndex={-1}
              className="flex items-center gap-2 text-base font-semibold text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              <Mail className="h-5 w-5 text-primary" aria-hidden="true" />
              {t("pendingTitle")}
            </h2>
            <AuditorPendingInvitations
              invitations={data.pendingInvitations}
              locale={locale}
              headingRef={pendingHeading}
              onCancelled={handleCancelled}
            />
          </section>
        </>
      )}
    </div>
  );
}
