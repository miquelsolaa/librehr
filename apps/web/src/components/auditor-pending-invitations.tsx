"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { MailX } from "lucide-react";
import type { PendingAuditorInvitation } from "@librehr/contracts";
import { Button, ConfirmDialog } from "@librehr/ui";
import { getApiClient } from "@/lib/api-client";
import { formatCalendarDay } from "@/lib/auditor-access";

interface AuditorPendingInvitationsProps {
  invitations: PendingAuditorInvitation[];
  locale: string;
  /** Focus target once the cancelled row is gone. */
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  onCancelled: (id: string, message: string) => void;
}

/** TIM-008: auditor invitations not yet accepted, which admins can cancel. */
export function AuditorPendingInvitations({
  invitations,
  locale,
  headingRef,
  onCancelled,
}: AuditorPendingInvitationsProps) {
  const t = useTranslations("auditorAccess");
  const tCommon = useTranslations("common");
  const [cancelling, setCancelling] =
    React.useState<PendingAuditorInvitation | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const opener = React.useRef<HTMLElement | null>(null);

  const handleCancel = async () => {
    if (!cancelling) return;
    setBusy(true);
    setError(null);
    try {
      await getApiClient().cancelAuditorInvitation(cancelling.id);
      onCancelled(cancelling.id, t("invitationCancelled"));
    } catch {
      setError(t("actionError"));
    } finally {
      setBusy(false);
    }
  };

  if (invitations.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("noPending")}</p>;
  }

  return (
    <>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <ul className="divide-y divide-border rounded-card border border-border">
        {invitations.map((invite) => (
          <li
            key={invite.id}
            className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0 space-y-1">
              <p className="truncate text-sm font-medium text-foreground">
                {invite.email}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("endsOn", {
                  date: formatCalendarDay(invite.accessUntil, locale),
                })}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={(e) => {
                opener.current = e.currentTarget;
                setError(null);
                setCancelling(invite);
              }}
              aria-label={`${t("cancelInvitation")}: ${invite.email}`}
            >
              <MailX className="mr-1.5 h-4 w-4" aria-hidden="true" />
              {t("cancelInvitation")}
            </Button>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={cancelling !== null}
        onOpenChange={(open) => {
          if (!open) setCancelling(null);
        }}
        title={t("cancelInvitationTitle")}
        description={t("cancelInvitationDescription", {
          email: cancelling?.email ?? "",
        })}
        confirmText={t("cancelInvitation")}
        cancelText={tCommon("cancel")}
        onConfirm={handleCancel}
        isLoading={busy}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (opener.current?.isConnected) opener.current.focus();
          else headingRef.current?.focus();
        }}
      />
    </>
  );
}
