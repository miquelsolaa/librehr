"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Clock } from "lucide-react";
import {
  AUDITOR_ACCESS_MAX_DAYS_MAX,
  AUDITOR_ACCESS_MAX_DAYS_MIN,
} from "@librehr/contracts";
import { Button, Input } from "@librehr/ui";
import { getApiClient } from "@/lib/api-client";

interface AuditorMaxDaysFormProps {
  maxDays: number;
  className?: string;
  onSaved: (maxDays: number, message: string) => void;
}

/** TIM-008: the organization's maximum auditor access period. */
export function AuditorMaxDaysForm({
  maxDays,
  className,
  onSaved,
}: AuditorMaxDaysFormProps) {
  const t = useTranslations("auditorAccess");
  const [value, setValue] = React.useState(String(maxDays));
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => setValue(String(maxDays)), [maxDays]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const days = Number(value);
    if (
      !Number.isInteger(days) ||
      days < AUDITOR_ACCESS_MAX_DAYS_MIN ||
      days > AUDITOR_ACCESS_MAX_DAYS_MAX
    ) {
      setError(t("maxDaysInvalid"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = await getApiClient().updateSecuritySettings({
        auditorAccessMaxDays: days,
      });
      onSaved(saved.auditorAccessMaxDays, t("maxDaysSaved"));
    } catch {
      setError(t("actionError"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className={className} noValidate>
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
          value={value}
          onChange={(e) => setValue(e.target.value)}
          error={error !== null}
          aria-invalid={error ? true : undefined}
          aria-describedby={
            error
              ? "auditor-max-days-hint auditor-max-days-error"
              : "auditor-max-days-hint"
          }
        />
        <p id="auditor-max-days-hint" className="text-xs text-muted-foreground">
          {t("maxDaysHint")}
        </p>
        {error && (
          <p
            id="auditor-max-days-error"
            role="alert"
            className="text-sm text-danger"
          >
            {error}
          </p>
        )}
      </div>
      <Button type="submit" variant="outline" isLoading={saving}>
        {t("maxDaysSave")}
      </Button>
    </form>
  );
}
