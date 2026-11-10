"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { CalendarClock, UserX } from "lucide-react";
import type { Auditor } from "@librehr/contracts";
import {
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from "@librehr/ui";
import { getApiClient } from "@/lib/api-client";
import { formatDate } from "@/lib/format";
import {
  auditorAccessErrorKey,
  daysLeft,
  endOfLocalDayIso,
  latestEndDateInput,
  localDateInput,
} from "@/lib/auditor-access";

interface AuditorAccessListProps {
  auditors: Auditor[];
  maxDays: number;
  locale: string;
  /** Called after a successful change with the message to announce. */
  onChanged: (message: string) => void;
}

/** TIM-008: the organization's auditors, with extend and revoke actions. */
export function AuditorAccessList({
  auditors,
  maxDays,
  locale,
  onChanged,
}: AuditorAccessListProps) {
  const t = useTranslations("auditorAccess");
  const tCommon = useTranslations("common");

  const [extending, setExtending] = React.useState<Auditor | null>(null);
  const [endDate, setEndDate] = React.useState("");
  const [extendError, setExtendError] = React.useState<string | null>(null);
  const [revoking, setRevoking] = React.useState<Auditor | null>(null);
  const [revokeError, setRevokeError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const openExtend = (auditor: Auditor) => {
    setExtending(auditor);
    setEndDate(latestEndDateInput(maxDays));
    setExtendError(null);
  };

  const handleExtend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!extending) return;
    if (!endDate) {
      setExtendError(t("errorRequired"));
      return;
    }
    setBusy(true);
    setExtendError(null);
    try {
      await getApiClient().updateAuditorAccess(extending.userId, {
        accessExpiresAt: endOfLocalDayIso(endDate),
      });
      setExtending(null);
      onChanged(t("extended"));
    } catch (err) {
      setExtendError(t(auditorAccessErrorKey(err), { maxDays }));
    } finally {
      setBusy(false);
    }
  };

  const handleRevoke = async () => {
    if (!revoking) return;
    setBusy(true);
    setRevokeError(null);
    try {
      await getApiClient().updateAuditorAccess(revoking.userId, {
        revoke: true,
      });
      onChanged(t("revoked"));
    } catch {
      setRevokeError(t("actionError"));
    } finally {
      setBusy(false);
    }
  };

  if (auditors.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("empty")}</p>;
  }

  return (
    <>
      {revokeError && (
        <p role="alert" className="text-sm text-danger">
          {revokeError}
        </p>
      )}
      <ul className="divide-y divide-border rounded-card border border-border">
        {auditors.map((auditor) => {
          const left = auditor.accessExpiresAt
            ? daysLeft(auditor.accessExpiresAt)
            : null;
          return (
            <li
              key={auditor.userId}
              className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 space-y-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {auditor.name}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {auditor.email}
                </p>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {auditor.accessExpiresAt ? (
                    <span>
                      {t("endsOn", {
                        date: formatDate(auditor.accessExpiresAt, locale),
                      })}
                    </span>
                  ) : (
                    <span>{t("noEndDate")}</span>
                  )}
                  {left !== null &&
                    (left > 0 ? (
                      <Badge>{t("daysLeft", { count: left })}</Badge>
                    ) : (
                      <Badge variant="danger">{t("expired")}</Badge>
                    ))}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openExtend(auditor)}
                  aria-label={`${t("extend")}: ${auditor.name}`}
                >
                  <CalendarClock
                    className="mr-1.5 h-4 w-4"
                    aria-hidden="true"
                  />
                  {t("extend")}
                </Button>
                {left !== 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-danger border-danger/30 hover:bg-danger/10"
                    onClick={() => {
                      setRevokeError(null);
                      setRevoking(auditor);
                    }}
                    aria-label={`${t("revoke")}: ${auditor.name}`}
                  >
                    <UserX className="mr-1.5 h-4 w-4" aria-hidden="true" />
                    {t("revoke")}
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <Dialog
        open={extending !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setExtending(null);
        }}
      >
        <DialogContent>
          <form onSubmit={handleExtend} className="space-y-4" noValidate>
            <DialogHeader>
              <DialogTitle>{t("extendTitle")}</DialogTitle>
              <DialogDescription>
                {t("extendDescription", { name: extending?.name ?? "" })}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <label
                htmlFor="extend-end-date"
                className="text-sm font-medium text-foreground"
              >
                {t("endDateLabel")}
              </label>
              <Input
                id="extend-end-date"
                type="date"
                required
                min={localDateInput(0)}
                max={latestEndDateInput(maxDays)}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                error={extendError !== null}
                aria-invalid={extendError ? true : undefined}
                aria-describedby={
                  extendError
                    ? "extend-end-date-hint extend-end-date-error"
                    : "extend-end-date-hint"
                }
              />
              <p
                id="extend-end-date-hint"
                className="text-xs text-muted-foreground"
              >
                {t("endDateHint", { maxDays })}
              </p>
              {extendError && (
                <p
                  id="extend-end-date-error"
                  role="alert"
                  className="text-sm text-danger"
                >
                  {extendError}
                </p>
              )}
            </div>
            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setExtending(null)}
                disabled={busy}
              >
                {tCommon("cancel")}
              </Button>
              <Button type="submit" isLoading={busy}>
                {t("extendSubmit")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => {
          if (!open) setRevoking(null);
        }}
        title={t("revokeTitle")}
        description={t("revokeDescription", { name: revoking?.name ?? "" })}
        confirmText={t("revokeConfirm")}
        cancelText={tCommon("cancel")}
        onConfirm={handleRevoke}
        isLoading={busy}
      />
    </>
  );
}
