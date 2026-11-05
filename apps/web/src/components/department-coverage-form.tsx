"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@librehr/ui";
import type { Department } from "@librehr/contracts";
import { apiClient } from "@/lib/api-client";

export function DepartmentCoverageForm({
  department,
  onSaved,
}: {
  department: Department;
  onSaved: (value: number) => void;
}) {
  const t = useTranslations("settings");
  const [value, setValue] = React.useState(
    department.minPresencePercent === null
      ? ""
      : String(department.minPresencePercent),
  );
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<
    "coverageInvalid" | "actionError" | null
  >(null);
  const [saved, setSaved] = React.useState(false);
  const fieldId = React.useId();
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const number = Number(value);
    setSaved(false);
    if (
      value.trim() === "" ||
      !Number.isInteger(number) ||
      number < 0 ||
      number > 100
    ) {
      setError("coverageInvalid");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await apiClient.updateDepartmentCoverage(department.id, {
        minPresencePercent: number,
      });
      onSaved(result.minPresencePercent);
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
      className="mt-3 space-y-2 border-t border-border pt-3"
    >
      <label htmlFor={fieldId} className="block text-sm font-medium">
        {t("coverageLabel")}
      </label>
      <p id={`${fieldId}-hint`} className="text-xs text-muted-foreground">
        {t("coverageHint")}
      </p>
      {department.minPresencePercent === null && (
        <p className="text-sm text-muted-foreground">
          {t("coverageUnconfigured")}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <input
          id={fieldId}
          type="number"
          min="0"
          max="100"
          step="1"
          required
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setSaved(false);
          }}
          aria-describedby={`${fieldId}-hint`}
          className="h-11 w-28 rounded-input border border-border bg-background px-3 text-sm"
        />
        <Button type="submit" variant="outline" disabled={saving}>
          {t("coverageSave")}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {t(error)}
        </p>
      )}
      {saved && (
        <p role="status" className="text-sm text-success">
          {t("coverageSaved")}
        </p>
      )}
    </form>
  );
}
