"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@librehr/ui";
import type { LeavePolicy } from "@librehr/contracts";
import { apiClient } from "@/lib/api-client";

/**
 * LEA-002 (#118): sets or clears a policy's full-time week. Empty keeps FTE
 * 1.0 (no part-time proration), which statutory vacation requires.
 */
export function LeavePolicyProrationForm({
  policy,
  onSaved,
}: {
  policy: LeavePolicy;
  onSaved: (policy: LeavePolicy) => void;
}) {
  const t = useTranslations("leavePolicies");
  const [value, setValue] = React.useState(
    policy.fullTimeHoursPerWeek === null
      ? ""
      : String(policy.fullTimeHoursPerWeek),
  );
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<
    "hoursInvalid" | "actionError" | null
  >(null);
  const [saved, setSaved] = React.useState(false);
  const fieldId = React.useId();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaved(false);
    const trimmed = value.trim();
    const hours = trimmed === "" ? null : Number(trimmed);
    if (
      hours !== null &&
      !(
        Number.isFinite(hours) &&
        hours > 0 &&
        hours <= 168 &&
        // At most two decimals (numeric(5,2)), tolerant of float noise.
        Math.abs(Math.round(hours * 100) - hours * 100) < 1e-6
      )
    ) {
      setError("hoursInvalid");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      onSaved(
        await apiClient.updateLeavePolicy(policy.id, {
          fullTimeHoursPerWeek: hours,
        }),
      );
      setSaved(true);
    } catch {
      setError("actionError");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      // Validated in submit, so the error is announced in the page.
      noValidate
      className="mt-3 space-y-2 border-t border-border pt-3"
    >
      <label htmlFor={fieldId} className="block text-sm font-medium">
        {t("fullTimeLabel")}
      </label>
      <p id={`${fieldId}-hint`} className="text-xs text-muted-foreground">
        {t("fullTimeHint")}
      </p>
      <p className="text-sm text-muted-foreground">
        {policy.fullTimeHoursPerWeek === null
          ? t("notProrated")
          : t("prorated", { hours: policy.fullTimeHoursPerWeek })}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id={fieldId}
          type="number"
          inputMode="decimal"
          min="0.01"
          max="168"
          step="0.01"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setSaved(false);
          }}
          aria-describedby={`${fieldId}-hint`}
          className="h-11 w-28 rounded-input border border-border bg-background px-3 text-sm"
        />
        <Button type="submit" variant="outline" disabled={saving}>
          {t("save")}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {t(error)}
        </p>
      )}
      {saved && (
        <p role="status" className="text-sm text-success">
          {t("saved")}
        </p>
      )}
    </form>
  );
}
