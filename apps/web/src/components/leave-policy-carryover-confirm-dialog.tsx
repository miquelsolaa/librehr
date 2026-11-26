"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@librehr/ui";

export interface LeavePolicyCarryoverConfirmDialogProps {
  open: boolean;
  policyName: string;
  maxDays: number;
  /** Already clamped to 1..12, as the close does. */
  expiryMonths: number;
  onCancel: () => void;
  onConfirm: () => void;
  /** Where focus goes on close: the Save button may be disabled by then. */
  onCloseAutoFocus: (event: Event) => void;
}

/**
 * LEA-002 (#133): turning carry-over enforcement on can make employees lose
 * days, and the ET art. 38.3 protection rules are still pending review by
 * labour counsel. The admin must read what the close will do and tick an
 * explicit acknowledgement first. The acknowledgement is UI-only; the change
 * itself is audited by the API (`leave.policy.update`).
 */
export function LeavePolicyCarryoverConfirmDialog({
  open,
  policyName,
  maxDays,
  expiryMonths,
  onCancel,
  onConfirm,
  onCloseAutoFocus,
}: LeavePolicyCarryoverConfirmDialogProps) {
  const t = useTranslations("leavePolicies");
  const [acknowledged, setAcknowledged] = React.useState(false);
  const ackId = React.useId();

  React.useEffect(() => {
    if (open) setAcknowledged(false);
  }, [open]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>{t("carryoverConfirmTitle")}</DialogTitle>
          <DialogDescription>
            {t("carryoverConfirmIntro", { policy: policyName })}
          </DialogDescription>
        </DialogHeader>
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-foreground">
          <li>{t("carryoverConfirmCap", { days: maxDays })}</li>
          <li>{t("carryoverConfirmExpiry", { months: expiryMonths })}</li>
          <li>{t("carryoverConfirmProtected")}</li>
          <li>{t("carryoverConfirmLateLeave")}</li>
        </ul>
        <p className="rounded-md border border-warning bg-warning/10 p-3 text-sm text-foreground">
          <strong>{t("carryoverLegalPendingTitle")}</strong>{" "}
          {t("carryoverLegalPending")}
        </p>
        <div className="flex items-start gap-2">
          <input
            id={ackId}
            type="checkbox"
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
            className="mt-0.5 h-6 w-6 shrink-0 rounded-sm border-border"
          />
          <label htmlFor={ackId} className="text-sm font-medium">
            {t("carryoverConfirmAck")}
          </label>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            {t("carryoverConfirmCancel")}
          </Button>
          <Button
            type="button"
            variant="danger"
            disabled={!acknowledged}
            onClick={onConfirm}
          >
            {t("carryoverConfirmSubmit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
