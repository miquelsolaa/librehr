"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronLeft, ShieldCheck } from "lucide-react";
import { PageHeader } from "@librehr/ui";
import type { OfficialExportResponse } from "@librehr/contracts";
import { getStoredSession } from "@/lib/auth";
import { downloadTimeExport, getApiClient } from "@/lib/api-client";
import {
  canExportOrganization,
  canExportOthers,
  currentMonthRange,
  exportErrorKey,
  isValidExportPeriod,
  saveBlob,
  type ExportErrorKey,
  type ExportLocale,
  type ExportScope,
} from "@/lib/time-export";
import { useExportEmployees } from "@/lib/use-export-employees";
import {
  TimeExportForm,
  type ExportAction,
} from "@/components/time-export-form";
import { TimeExportPreview } from "@/components/time-export-preview";
import { TimeExportReceipt } from "@/components/time-export-receipt";

export default function TimeExportPage() {
  const params = useParams();
  const locale = (params?.["locale"] as string | undefined) ?? "ca";
  const t = useTranslations("timeTracking");

  const [defaults] = React.useState(() => currentMonthRange());
  const [startDate, setStartDate] = React.useState(defaults.startDate);
  const [endDate, setEndDate] = React.useState(defaults.endDate);
  const [docLocale, setDocLocale] = React.useState<ExportLocale>(
    locale === "es" || locale === "en" ? locale : "ca",
  );
  const [scope, setScope] = React.useState<ExportScope>("employee");

  // The cached profile lives in localStorage: read it after mount so the
  // server render and the first client render agree.
  const [role, setRole] = React.useState<string | undefined>(undefined);
  React.useEffect(() => setRole(getStoredSession()?.role), []);
  const allowOrganization = canExportOrganization(role);
  const allowOthers = canExportOthers(role);

  const picker = useExportEmployees({
    enabled: allowOthers,
    startDate,
    endDate,
  });
  const { employeeId } = picker;
  // An export started while the list reloads could target a stale choice.
  const pickerLoading =
    allowOthers && scope === "employee" && picker.directoryLoading;

  const [busy, setBusy] = React.useState<ExportAction | null>(null);
  const [error, setError] = React.useState<ExportErrorKey | null>(null);
  const [doc, setDoc] = React.useState<OfficialExportResponse | null>(null);
  const [receipt, setReceipt] = React.useState<{
    exportId: string;
    contentHash: string;
  } | null>(null);
  const [downloaded, setDownloaded] = React.useState<string | null>(null);

  const run = async (action: ExportAction) => {
    if (!isValidExportPeriod(startDate, endDate)) {
      setError("exportErrorInvalidPeriod");
      return;
    }
    const selected =
      scope === "employee" && allowOthers && employeeId ? employeeId : null;
    const query = {
      startDate,
      endDate,
      scope,
      locale: docLocale,
      ...(selected ? { employeeId: selected } : {}),
    };

    setError(null);
    setDownloaded(null);
    picker.clearSelectionReset();
    setReceipt(null);
    // A preview left on screen would show another export's id and hash.
    setDoc(null);
    setBusy(action);
    try {
      if (action === "json") {
        const res = await getApiClient().getOfficialExport(query);
        setDoc(res);
        setReceipt({ exportId: res.exportId, contentHash: res.contentHash });
      } else {
        const file = await downloadTimeExport({ ...query, format: action });
        saveBlob(file.blob, file.filename);
        setDownloaded(file.filename);
        if (file.exportId && file.contentHash) {
          setReceipt({
            exportId: file.exportId,
            contentHash: file.contentHash,
          });
        }
      }
    } catch (err: unknown) {
      setError(exportErrorKey(err, selected !== null));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={
          <Link
            href={`/${locale}/time`}
            className="inline-flex items-center gap-1 rounded-input text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            {t("backToTime")}
          </Link>
        }
        title={t("exportTitle")}
        description={t("exportIntro")}
      />

      {role === "auditor" && (
        <div className="rounded-card border border-border bg-surface p-4 text-sm text-foreground">
          <div className="flex items-center gap-2 font-semibold">
            <ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" />
            {t("inspectorRoleNotice")}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("inspectorAuditLogNotice")}
          </p>
        </div>
      )}

      <div className="space-y-6 rounded-card border border-border bg-surface p-4 sm:p-6">
        <p className="border-b border-border pb-4 text-xs text-muted-foreground">
          {t("exportLegalNotice")}
        </p>

        <TimeExportForm
          startDate={startDate}
          endDate={endDate}
          docLocale={docLocale}
          scope={scope}
          employeeId={employeeId}
          onStartDateChange={setStartDate}
          onEndDateChange={setEndDate}
          onDocLocaleChange={setDocLocale}
          onScopeChange={setScope}
          onEmployeeChange={picker.selectEmployee}
          allowOrganization={allowOrganization}
          allowOthers={allowOthers}
          directory={picker.directory}
          directoryFailed={picker.directoryFailed}
          directoryLoading={picker.directoryLoading}
          pickerLoading={pickerLoading}
          busy={busy}
          onRun={(action) => void run(action)}
        />

        <p role="status" className="text-sm text-muted-foreground empty:hidden">
          {busy
            ? t("generating")
            : downloaded
              ? t("exportDownloaded", { filename: downloaded })
              : picker.selectionReset
                ? t("exportEmployeeReset")
                : ""}
        </p>

        {error && (
          <p role="alert" className="text-sm text-danger">
            {t(error)}
          </p>
        )}

        {receipt && <TimeExportReceipt {...receipt} />}

        {doc && <TimeExportPreview doc={doc} />}
      </div>
    </div>
  );
}
