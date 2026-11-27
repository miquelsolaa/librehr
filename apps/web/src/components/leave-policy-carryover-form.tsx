"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@librehr/ui";
import type { LeavePolicy } from "@librehr/contracts";
import { apiClient } from "@/lib/api-client";
import { LeavePolicyCarryoverConfirmDialog } from "./leave-policy-carryover-confirm-dialog";

/**
 * LEA-002 (#132): opts a policy in to (or out of) the year-end carry-over
 * cap, forfeit and expiry. Off by default: the whole balance is carried
 * over. Employees with leave protected by ET art. 38.3 never lose days.
 * Turning it on asks for an explicit acknowledgement first (#133), because
 * the protection rules are pending legal review; turning it off does not.
 */
export function LeavePolicyCarryoverForm({
  policy,
  onSaved,
}: {
  policy: LeavePolicy;
  onSaved: (policy: LeavePolicy) => void;
}) {
  const t = useTranslations("leavePolicies");
  const [enforced, setEnforced] = React.useState(policy.carryoverEnforced);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  const toggleRef = React.useRef<HTMLInputElement>(null);
  const fieldId = React.useId();
  // The close clamps the months to 1..12 (core `carryover.ts`).
  const expiryMonths = Math.min(12, Math.max(1, policy.carryoverExpiryMonths));

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (enforced && !policy.carryoverEnforced) {
      setConfirming(true);
      return;
    }
    void save();
  }

  async function save() {
    setSaved(false);
    setSaving(true);
    setError(false);
    try {
      onSaved(
        await apiClient.updateLeavePolicy(policy.id, {
          carryoverEnforced: enforced,
        }),
      );
      setSaved(true);
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="mt-3 space-y-2 border-t border-border pt-3"
    >
      <div className="flex items-start gap-2">
        <input
          ref={toggleRef}
          id={fieldId}
          type="checkbox"
          checked={enforced}
          onChange={(event) => {
            setEnforced(event.target.checked);
            setSaved(false);
          }}
          // The policy's name tells the rows apart for screen readers.
          aria-describedby={`${fieldId}-hint ${fieldId}-policy`}
          className="mt-0.5 h-6 w-6 rounded-sm border-border"
        />
        <span id={`${fieldId}-policy`} className="sr-only">
          {policy.name}
        </span>
        <label htmlFor={fieldId} className="text-sm font-medium">
          {t("carryoverLabel")}
        </label>
      </div>
      <p id={`${fieldId}-hint`} className="text-xs text-muted-foreground">
        {t("carryoverHint")}
      </p>
      <p className="text-sm text-muted-foreground">
        {policy.carryoverEnforced
          ? t("carryoverOn", {
              days: policy.carryoverMaxDays,
              months: expiryMonths,
            })
          : t("carryoverOff")}
      </p>
      {policy.carryoverEnforced && (
        <p className="text-sm text-warning">
          <strong>{t("carryoverLegalPendingTitle")}</strong>{" "}
          {t("carryoverLegalPending")}
        </p>
      )}
      <Button
        type="submit"
        variant="outline"
        disabled={saving || enforced === policy.carryoverEnforced}
        aria-describedby={`${fieldId}-policy`}
      >
        {t("carryoverSave")}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {t("actionError")}
        </p>
      )}
      {saved && (
        <p role="status" className="text-sm text-success">
          {t("saved")}
        </p>
      )}
      <LeavePolicyCarryoverConfirmDialog
        open={confirming}
        policyName={policy.name}
        maxDays={policy.carryoverMaxDays}
        expiryMonths={expiryMonths}
        onCancel={() => {
          // Cancelling leaves the policy as it was.
          setConfirming(false);
          setEnforced(policy.carryoverEnforced);
        }}
        onConfirm={() => {
          setConfirming(false);
          void save();
        }}
        onCloseAutoFocus={(event) => {
          // The Save button is disabled after either choice; the toggle stays.
          event.preventDefault();
          toggleRef.current?.focus();
        }}
      />
    </form>
  );
}
