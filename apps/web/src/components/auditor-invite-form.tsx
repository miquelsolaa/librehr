"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { UserPlus } from "lucide-react";
import { Button, Input } from "@librehr/ui";
import { getApiClient } from "@/lib/api-client";
import { auditorAccessErrorKey, isAccessDateError } from "@/lib/auditor-access";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface AuditorInviteFormProps {
  /** Today and the latest allowed last day, in the organization's zone. */
  today: string;
  latestAccessUntil: string;
  maxDays: number;
  timeZone: string;
  className?: string;
  onInvited: (message: string) => void;
}

/** TIM-008: invite an auditor with the last day of their access. */
export function AuditorInviteForm({
  today,
  latestAccessUntil,
  maxDays,
  timeZone,
  className,
  onInvited,
}: AuditorInviteFormProps) {
  const t = useTranslations("auditorAccess");
  const [email, setEmail] = React.useState("");
  const [accessUntil, setAccessUntil] = React.useState("");
  const [emailError, setEmailError] = React.useState<string | null>(null);
  const [dateError, setDateError] = React.useState<string | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [sending, setSending] = React.useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const nextEmailError = EMAIL_PATTERN.test(email.trim())
      ? null
      : t("errorEmail");
    const nextDateError = accessUntil ? null : t("errorRequired");
    setEmailError(nextEmailError);
    setDateError(nextDateError);
    setFormError(null);
    if (nextEmailError || nextDateError) return;

    setSending(true);
    try {
      await getApiClient().createInvitation({
        email: email.trim(),
        role: "auditor",
        accessUntil,
      });
      setEmail("");
      setAccessUntil("");
      onInvited(t("inviteSent"));
    } catch (err) {
      const key = auditorAccessErrorKey(err);
      if (isAccessDateError(key)) setDateError(t(key, { maxDays }));
      else setFormError(t(key));
    } finally {
      setSending(false);
    }
  };

  const describedBy = (hint: string | null, error: string | null) =>
    [hint, error].filter(Boolean).join(" ") || undefined;

  return (
    <form onSubmit={handleSubmit} className={className} noValidate>
      <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
        <UserPlus className="h-5 w-5 text-primary" aria-hidden="true" />
        {t("inviteTitle")}
      </h2>
      <p className="text-sm text-muted-foreground">{t("inviteDescription")}</p>
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
          error={emailError !== null}
          aria-invalid={emailError ? true : undefined}
          aria-describedby={describedBy(
            null,
            emailError ? "auditor-email-error" : null,
          )}
        />
        {emailError && (
          <p
            id="auditor-email-error"
            role="alert"
            className="text-sm text-danger"
          >
            {emailError}
          </p>
        )}
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
          min={today}
          max={latestAccessUntil}
          value={accessUntil}
          onChange={(e) => setAccessUntil(e.target.value)}
          error={dateError !== null}
          aria-invalid={dateError ? true : undefined}
          aria-describedby={describedBy(
            "auditor-end-date-hint",
            dateError ? "auditor-end-date-error" : null,
          )}
        />
        <p id="auditor-end-date-hint" className="text-xs text-muted-foreground">
          {t("endDateHint", { maxDays, timeZone })}
        </p>
        {dateError && (
          <p
            id="auditor-end-date-error"
            role="alert"
            className="text-sm text-danger"
          >
            {dateError}
          </p>
        )}
      </div>
      {formError && (
        <p role="alert" className="text-sm text-danger">
          {formError}
        </p>
      )}
      <Button type="submit" isLoading={sending}>
        {t("inviteSubmit")}
      </Button>
    </form>
  );
}
