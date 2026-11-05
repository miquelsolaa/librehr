"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Input } from "@librehr/ui";
import { ArrowLeft, FileText, ShieldCheck, Download } from "lucide-react";
import { getStoredSession } from "@/lib/auth";
import { getApiClient } from "@/lib/api-client";
import type { OfficialExportResponse } from "@librehr/contracts";

export default function TimeExportPage() {
  const params = useParams();
  const locale = (params?.["locale"] as string | undefined) ?? "ca";

  const t = useTranslations("timeTracking");

  const now = new Date();
  const defaultStart = new Date(now.getFullYear(), now.getMonth(), 1)
    .toISOString()
    .slice(0, 10);
  const defaultEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    .toISOString()
    .slice(0, 10);

  const [startDate, setStartDate] = React.useState(defaultStart);
  const [endDate, setEndDate] = React.useState(defaultEnd);
  const [employeeId, setEmployeeId] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<
    "scheduleNotConfigured" | "exportUnavailable" | null
  >(null);
  const [doc, setDoc] = React.useState<OfficialExportResponse | null>(null);

  const session = getStoredSession();
  const isAuditor = session?.role === "auditor";

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session?.token) {
      setError("exportUnavailable");
      return;
    }

    setError(null);
    setDoc(null);
    setLoading(true);
    try {
      const client = getApiClient(session.token);
      const queryParams: {
        startDate: string;
        endDate: string;
        employeeId?: string;
      } = {
        startDate,
        endDate,
      };
      if (employeeId.trim()) {
        queryParams.employeeId = employeeId.trim();
      }
      const res = await client.getOfficialExport(queryParams);
      setDoc(res);
    } catch (err: unknown) {
      setError(
        typeof err === "object" &&
          err !== null &&
          "code" in err &&
          err.code === "SCHEDULE_NOT_CONFIGURED"
          ? "scheduleNotConfigured"
          : "exportUnavailable",
      );
    } finally {
      setLoading(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Link
          href={`/${locale}/time`}
          className="flex items-center text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back to Time Tracking
        </Link>
      </div>

      {isAuditor && (
        <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-4 text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200 shadow-sm">
          <div className="flex items-center gap-2 font-semibold">
            <ShieldCheck className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            {t("inspectorRoleNotice")}
          </div>
          <p className="mt-1 text-xs text-blue-700 dark:text-blue-300">
            {t("inspectorAuditLogNotice")}
          </p>
        </div>
      )}

      <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-border pb-4">
          <div className="flex items-center gap-3">
            <FileText className="h-6 w-6 text-primary" />
            <div>
              <h1 className="text-xl font-bold text-foreground">
                {t("exportTitle")}
              </h1>
              <p className="text-xs text-muted-foreground">
                Document conforming to Spanish Labour Inspection (ET art. 34.9,
                RDL 8/2019).
              </p>
            </div>
          </div>

          {error && (
            <p role="alert" className="text-sm text-danger">
              {t(error)}
            </p>
          )}
          <form
            onSubmit={(e) => void handleGenerate(e)}
            className="flex flex-wrap items-center gap-3"
          >
            {isAuditor && (
              <Input
                type="text"
                placeholder="Employee UUID (optional)"
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                className="w-48 text-xs font-mono"
              />
            )}
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              required
            />
            <span className="text-muted-foreground">to</span>
            <Input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              required
            />
            <Button type="submit" variant="default" disabled={loading}>
              {loading ? "Generating..." : t("generateExport")}
            </Button>
          </form>
        </div>

        {doc && (
          <div className="mt-6 space-y-6">
            {/* Tamper-evidence Integrity Banner */}
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-4">
              <div className="flex items-start gap-3">
                <ShieldCheck className="h-5 w-5 text-emerald-600 mt-0.5" />
                <div className="space-y-1 text-xs">
                  <p className="font-semibold text-emerald-900 dark:text-emerald-300">
                    Cryptographic Content Verification
                  </p>
                  <p className="text-emerald-700 dark:text-emerald-400 font-mono break-all">
                    {t("contentHash")}: {doc.documentContentHash}
                  </p>
                  <p className="text-muted-foreground">
                    Generated at: {doc.metadata.generatedAt} | Organization:{" "}
                    {doc.metadata.organizationName}
                  </p>
                </div>
              </div>
            </div>

            {/* Printable Document Sheet */}
            <div className="rounded-lg border border-border p-6 bg-card print:border-none print:p-0">
              <div className="flex justify-between items-center pb-4 border-b border-border">
                <div>
                  <h3 className="font-bold text-lg">
                    {doc.metadata.organizationName}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    Employee: {doc.metadata.employeeName}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handlePrint}
                  className="gap-2 print:hidden"
                >
                  <Download className="h-4 w-4" />
                  Print / Save PDF
                </Button>
              </div>

              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-border font-semibold uppercase text-muted-foreground">
                      <th className="py-2">Date</th>
                      <th className="py-2">Worked Minutes</th>
                      <th className="py-2">Overtime Minutes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {doc.days.map((d) => (
                      <tr key={d.date}>
                        <td className="py-2 font-medium">{d.date}</td>
                        <td className="py-2">
                          {d.totalWorkedMinutes}m (
                          {Math.round(d.totalWorkedMinutes / 6) / 10}h)
                        </td>
                        <td className="py-2">{d.overtimeMinutes}m</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-border font-bold">
                      <td className="py-3">TOTAL</td>
                      <td className="py-3">
                        {doc.totalWorkedMinutes}m (
                        {Math.round(doc.totalWorkedMinutes / 6) / 10}h)
                      </td>
                      <td className="py-3">{doc.totalOvertimeMinutes}m</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
