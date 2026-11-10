"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeft, Clock, UserPlus, Users } from "lucide-react";
import {
  AUDITOR_ACCESS_MAX_DAYS_MAX,
  AUDITOR_ACCESS_MAX_DAYS_MIN,
  type Auditor,
} from "@librehr/contracts";
import { Button, Input } from "@librehr/ui";
import { getApiClient } from "@/lib/api-client";
import { getStoredSession } from "@/lib/auth";
import {
  auditorAccessErrorKey,
  endOfLocalDayIso,
  latestEndDateInput,
  localDateInput,
} from "@/lib/auditor-access";
import { AuditorAccessList } from "@/components/auditor-access-list";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** TIM-008: Settings -> Inspector access (admins only). */
export default function AuditorAccessSettingsPage() {
  const params = useParams();
  const locale = (params?.["locale"] as string | undefined) ?? "ca";
  const t = useTranslations("auditorAccess");
  const tSettings = useTranslations("settings");

  const [isAdmin, setIsAdmin] = React.useState<boolean | null>(null);
  const [auditors, setAuditors] = React.useState<Auditor[]>([]);
  const [maxDays, setMaxDays] = React.useState(90);
  const [maxDaysInput, setMaxDaysInput] = React.useState("90");
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState(false);
  const [status, setStatus] = React.useState<string | null>(null);

  const [maxDaysError, setMaxDaysError] = React.useState<string | null>(null);
  const [savingMax, setSavingMax] = React.useState(false);

  const [email, setEmail] = React.useState("");
  const [endDate, setEndDate] = React.useState("");
  const [inviteError, setInviteError] = React.useState<string | null>(null);
  const [inviting, setInviting] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const client = getApiClient();
      const [list, settings] = await Promise.all([
        client.listAuditors(),
        client.getSecuritySettings(),
      ]);
      setAuditors(list.items);
      setMaxDays(settings.auditorAccessMaxDays);
      setMaxDaysInput(String(settings.auditorAccessMaxDays));
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    const admin = getStoredSession()?.role === "admin";
    setIsAdmin(admin);
    if (admin) void load();
    else setLoading(false);
  }, [load]);

  const handleSaveMax = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = Number(maxDaysInput);
    if (
      !Number.isInteger(value) ||
      value < AUDITOR_ACCESS_MAX_DAYS_MIN ||
      value > AUDITOR_ACCESS_MAX_DAYS_MAX
    ) {
      setMaxDaysError(t("maxDaysInvalid"));
      return;
    }
    setSavingMax(true);
    setMaxDaysError(null);
    setStatus(null);
    try {
      const saved = await getApiClient().updateSecuritySettings({
        auditorAccessMaxDays: value,
      });
      setMaxDays(saved.auditorAccessMaxDays);
      setStatus(t("maxDaysSaved"));
    } catch {
      setMaxDaysError(t("actionError"));
    } finally {
      setSavingMax(false);
    }
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus(null);
    if (!EMAIL_PATTERN.test(email.trim())) {
      setInviteError(t("errorEmail"));
      return;
    }
    if (!endDate) {
      setInviteError(t("errorRequired"));
      return;
    }
    setInviting(true);
    setInviteError(null);
    try {
      await getApiClient().createInvitation({
        email: email.trim(),
        role: "auditor",
        accessExpiresAt: endOfLocalDayIso(endDate),
      });
      setEmail("");
      setEndDate("");
      setStatus(t("inviteSent"));
    } catch (err) {
      setInviteError(t(auditorAccessErrorKey(err), { maxDays }));
    } finally {
      setInviting(false);
    }
  };

  const handleChanged = (message: string) => {
    setStatus(message);
    void load();
  };

  const cardClass =
    "rounded-card border border-border bg-surface p-4 shadow-sm space-y-4 sm:p-6";

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href={`/${locale}/settings`}
          className="rounded-btn p-2 text-muted-foreground hover:bg-surface hover:text-foreground transition-colors"
          aria-label={tSettings("backToSettings")}
        >
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {t("title")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>
      </div>

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

      {isAdmin && loadError && (
        <div role="alert" className="space-y-3 text-sm">
          <p className="text-danger">{t("loadError")}</p>
          <Button variant="outline" onClick={() => void load()}>
            {tSettings("retry")}
          </Button>
        </div>
      )}

      {isAdmin && !loadError && !loading && (
        <>
          <div className="grid gap-6 md:grid-cols-2">
            <form onSubmit={handleInvite} className={cardClass} noValidate>
              <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
                <UserPlus className="h-5 w-5 text-primary" aria-hidden="true" />
                {t("inviteTitle")}
              </h2>
              <p className="text-sm text-muted-foreground">
                {t("inviteDescription")}
              </p>
              <div className="space-y-1.5">
                <label
                  htmlFor="auditor-email"
                  className="text-sm font-medium text-foreground"
                >
                  {t("emailLabel")}
                </label>
                <Input
                  id="auditor-email"
                  type="email"
                  autoComplete="off"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label
                  htmlFor="auditor-end-date"
                  className="text-sm font-medium text-foreground"
                >
                  {t("endDateLabel")}
                </label>
                <Input
                  id="auditor-end-date"
                  type="date"
                  required
                  min={localDateInput(0)}
                  max={latestEndDateInput(maxDays)}
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  error={inviteError !== null}
                  aria-invalid={inviteError ? true : undefined}
                  aria-describedby={
                    inviteError
                      ? "auditor-end-date-hint auditor-invite-error"
                      : "auditor-end-date-hint"
                  }
                />
                <p
                  id="auditor-end-date-hint"
                  className="text-xs text-muted-foreground"
                >
                  {t("endDateHint", { maxDays })}
                </p>
              </div>
              {inviteError && (
                <p
                  id="auditor-invite-error"
                  role="alert"
                  className="text-sm text-danger"
                >
                  {inviteError}
                </p>
              )}
              <Button type="submit" isLoading={inviting}>
                {t("inviteSubmit")}
              </Button>
            </form>

            <form onSubmit={handleSaveMax} className={cardClass} noValidate>
              <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
                <Clock className="h-5 w-5 text-primary" aria-hidden="true" />
                {t("maxDaysTitle")}
              </h2>
              <div className="space-y-1.5">
                <label
                  htmlFor="auditor-max-days"
                  className="text-sm font-medium text-foreground"
                >
                  {t("maxDaysLabel")}
                </label>
                <Input
                  id="auditor-max-days"
                  type="number"
                  inputMode="numeric"
                  min={AUDITOR_ACCESS_MAX_DAYS_MIN}
                  max={AUDITOR_ACCESS_MAX_DAYS_MAX}
                  step={1}
                  value={maxDaysInput}
                  onChange={(e) => setMaxDaysInput(e.target.value)}
                  error={maxDaysError !== null}
                  aria-invalid={maxDaysError ? true : undefined}
                  aria-describedby={
                    maxDaysError
                      ? "auditor-max-days-hint auditor-max-days-error"
                      : "auditor-max-days-hint"
                  }
                />
                <p
                  id="auditor-max-days-hint"
                  className="text-xs text-muted-foreground"
                >
                  {t("maxDaysHint")}
                </p>
                {maxDaysError && (
                  <p
                    id="auditor-max-days-error"
                    role="alert"
                    className="text-sm text-danger"
                  >
                    {maxDaysError}
                  </p>
                )}
              </div>
              <Button type="submit" variant="outline" isLoading={savingMax}>
                {t("maxDaysSave")}
              </Button>
            </form>
          </div>

          <section className="space-y-3" aria-labelledby="auditors-heading">
            <h2
              id="auditors-heading"
              className="flex items-center gap-2 text-base font-semibold text-foreground"
            >
              <Users className="h-5 w-5 text-primary" aria-hidden="true" />
              {t("listTitle")}
            </h2>
            <AuditorAccessList
              auditors={auditors}
              maxDays={maxDays}
              locale={locale}
              onChanged={handleChanged}
            />
          </section>
        </>
      )}
    </div>
  );
}
