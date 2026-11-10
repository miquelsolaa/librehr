"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Input, PageHeader } from "@librehr/ui";
import { ChevronLeft, Download, Eye, ShieldCheck } from "lucide-react";
import type {
  EmployeeListItem,
  OfficialExportResponse,
} from "@librehr/contracts";
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
import { TimeExportPreview } from "@/components/time-export-preview";
import { TimeExportReceipt } from "@/components/time-export-receipt";

type Action = "json" | "csv" | "pdf";

const LABEL = "mb-1.5 block text-sm font-medium text-foreground";
const SELECT =
  "h-10 w-full rounded-input border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:cursor-not-allowed disabled:opacity-50";

/** Every page of the directory the API lets the caller see. */
async function loadDirectory(): Promise<EmployeeListItem[]> {
  const client = getApiClient();
  const items: EmployeeListItem[] = [];
  for (let page = 1; page <= 50; page++) {
    const res = await client.listEmployees({ page, pageSize: 100 });
    items.push(...res.items);
    if (res.items.length === 0 || items.length >= res.total) break;
  }
  return items;
}

function employeeName(e: EmployeeListItem): string {
  return `${e.preferredName ?? e.firstName} ${e.lastName}`;
}

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
  const [employeeId, setEmployeeId] = React.useState("");

  // The cached profile lives in localStorage: read it after mount so the
  // server render and the first client render agree.
  const [role, setRole] = React.useState<string | undefined>(undefined);
  React.useEffect(() => setRole(getStoredSession()?.role), []);
  const allowOrganization = canExportOrganization(role);
  const allowOthers = canExportOthers(role);

  const [directory, setDirectory] = React.useState<EmployeeListItem[]>([]);
  const [directoryFailed, setDirectoryFailed] = React.useState(false);
  React.useEffect(() => {
    if (!allowOthers) return;
    let cancelled = false;
    loadDirectory()
      .then((items) => {
        if (!cancelled) setDirectory(items);
      })
      .catch(() => {
        if (!cancelled) setDirectoryFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [allowOthers]);

  const [busy, setBusy] = React.useState<Action | null>(null);
  const [error, setError] = React.useState<ExportErrorKey | null>(null);
  const [doc, setDoc] = React.useState<OfficialExportResponse | null>(null);
  const [receipt, setReceipt] = React.useState<{
    exportId: string;
    contentHash: string;
  } | null>(null);
  const [downloaded, setDownloaded] = React.useState<string | null>(null);

  const run = async (action: Action) => {
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

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void run("json");
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
        <div className="rounded-xl border border-border bg-surface p-4 text-sm text-foreground shadow-sm">
          <div className="flex items-center gap-2 font-semibold">
            <ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" />
            {t("inspectorRoleNotice")}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("inspectorAuditLogNotice")}
          </p>
        </div>
      )}

      <div className="space-y-6 rounded-xl border border-border bg-surface p-4 shadow-sm sm:p-6">
        <p className="border-b border-border pb-4 text-xs text-muted-foreground">
          {t("exportLegalNotice")}
        </p>

        <form
          onSubmit={onSubmit}
          aria-busy={busy !== null}
          className="space-y-4"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label htmlFor="export-start" className={LABEL}>
                {t("startDate")}
              </label>
              <Input
                id="export-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
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
                onChange={(e) => setEndDate(e.target.value)}
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
                onChange={(e) => setDocLocale(e.target.value as ExportLocale)}
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
                  onChange={(e) => setScope(e.target.value as ExportScope)}
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
                  onChange={(e) => setEmployeeId(e.target.value)}
                  aria-describedby={
                    directoryFailed ? "export-directory-hint" : undefined
                  }
                  className={SELECT}
                >
                  <option value="">{t("exportEmployeeSelf")}</option>
                  {directory.map((e) => (
                    <option key={e.id} value={e.id}>
                      {employeeName(e)}
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
              disabled={busy !== null}
              isLoading={busy === "json"}
              className="gap-2"
            >
              {busy !== "json" && (
                <Eye className="h-4 w-4" aria-hidden="true" />
              )}
              {t("exportPreview")}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy !== null}
              isLoading={busy === "csv"}
              onClick={() => void run("csv")}
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
              disabled={busy !== null}
              isLoading={busy === "pdf"}
              onClick={() => void run("pdf")}
              className="gap-2"
            >
              {busy !== "pdf" && (
                <Download className="h-4 w-4" aria-hidden="true" />
              )}
              {t("exportDownloadPdf")}
            </Button>
          </div>
        </form>

        <p role="status" className="text-sm text-muted-foreground empty:hidden">
          {busy
            ? t("generating")
            : downloaded
              ? t("exportDownloaded", { filename: downloaded })
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
