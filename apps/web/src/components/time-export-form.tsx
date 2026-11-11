"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Button, Input } from "@librehr/ui";
import { Download, Eye } from "lucide-react";
import type { ExportLocale, ExportScope } from "@/lib/time-export";
import type { PickerEmployee } from "@/lib/use-export-employees";

export type ExportAction = "json" | "csv" | "pdf";

const LABEL = "mb-1.5 block text-sm font-medium text-foreground";
const SELECT =
  "h-10 w-full rounded-input border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:cursor-not-allowed disabled:opacity-50";

export interface TimeExportFormProps {
  startDate: string;
  endDate: string;
  docLocale: ExportLocale;
  scope: ExportScope;
  employeeId: string;
  onStartDateChange: (value: string) => void;
  onEndDateChange: (value: string) => void;
  onDocLocaleChange: (value: ExportLocale) => void;
  onScopeChange: (value: ExportScope) => void;
  onEmployeeChange: (value: string) => void;
  allowOrganization: boolean;
  allowOthers: boolean;
  directory: readonly PickerEmployee[];
  directoryFailed: boolean;
  directoryLoading: boolean;
  /** The picker is reloading: an export now could target a stale choice. */
  pickerLoading: boolean;
  busy: ExportAction | null;
  onRun: (action: ExportAction) => void;
}

/**
 * TIM-006: the controls of the official export (period, document language,
 * scope, employee picker) and its preview and download buttons.
 */
export function TimeExportForm({
  startDate,
  endDate,
  docLocale,
  scope,
  employeeId,
  onStartDateChange,
  onEndDateChange,
  onDocLocaleChange,
  onScopeChange,
  onEmployeeChange,
  allowOrganization,
  allowOthers,
  directory,
  directoryFailed,
  directoryLoading,
  pickerLoading,
  busy,
  onRun,
}: TimeExportFormProps) {
  const t = useTranslations("timeTracking");

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onRun("json");
  };

  return (
    <form onSubmit={onSubmit} aria-busy={busy !== null} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label htmlFor="export-start" className={LABEL}>
            {t("startDate")}
          </label>
          <Input
            id="export-start"
            type="date"
            value={startDate}
            onChange={(e) => onStartDateChange(e.target.value)}
            required
          />
        </div>
        <div>
          <label htmlFor="export-end" className={LABEL}>
            {t("endDate")}
          </label>
          <Input
            id="export-end"
            type="date"
            value={endDate}
            min={startDate}
            onChange={(e) => onEndDateChange(e.target.value)}
            required
          />
        </div>
        <div>
          <label htmlFor="export-locale" className={LABEL}>
            {t("exportLanguage")}
          </label>
          <select
            id="export-locale"
            value={docLocale}
            onChange={(e) => onDocLocaleChange(e.target.value as ExportLocale)}
            className={SELECT}
          >
            {/* Endonyms, as in the language switcher. */}
            <option value="ca" lang="ca">
              Català
            </option>
            <option value="es" lang="es">
              Español
            </option>
            <option value="en" lang="en">
              English
            </option>
          </select>
        </div>
        {allowOrganization && (
          <div>
            <label htmlFor="export-scope" className={LABEL}>
              {t("exportScope")}
            </label>
            <select
              id="export-scope"
              value={scope}
              onChange={(e) => onScopeChange(e.target.value as ExportScope)}
              className={SELECT}
            >
              <option value="employee">{t("exportScopeEmployee")}</option>
              <option value="organization">
                {t("exportScopeOrganization")}
              </option>
            </select>
          </div>
        )}
        {allowOthers && scope === "employee" && (
          <div className="sm:col-span-2 lg:col-span-1">
            <label htmlFor="export-employee" className={LABEL}>
              {t("exportEmployeeLabel")}
            </label>
            <select
              id="export-employee"
              value={employeeId}
              onChange={(e) => onEmployeeChange(e.target.value)}
              disabled={directoryLoading}
              aria-describedby={
                directoryFailed ? "export-directory-hint" : undefined
              }
              className={SELECT}
            >
              <option value="">{t("exportEmployeeSelf")}</option>
              {directory.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
            {directoryFailed && (
              <p
                id="export-directory-hint"
                className="mt-1.5 text-xs text-muted-foreground"
              >
                {t("exportDirectoryUnavailable")}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button
          type="submit"
          disabled={busy !== null || pickerLoading}
          isLoading={busy === "json"}
          className="gap-2"
        >
          {busy !== "json" && <Eye className="h-4 w-4" aria-hidden="true" />}
          {t("exportPreview")}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy !== null || pickerLoading}
          isLoading={busy === "csv"}
          onClick={() => onRun("csv")}
          className="gap-2"
        >
          {busy !== "csv" && (
            <Download className="h-4 w-4" aria-hidden="true" />
          )}
          {t("exportDownloadCsv")}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy !== null || pickerLoading}
          isLoading={busy === "pdf"}
          onClick={() => onRun("pdf")}
          className="gap-2"
        >
          {busy !== "pdf" && (
            <Download className="h-4 w-4" aria-hidden="true" />
          )}
          {t("exportDownloadPdf")}
        </Button>
      </div>
    </form>
  );
}
