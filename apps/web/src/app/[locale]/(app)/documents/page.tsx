"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  FileText,
  Upload,
  Trash2,
  FolderOpen,
  Users,
  CheckCircle2,
  AlertCircle,
  FileSpreadsheet,
} from "lucide-react";
import { Button } from "@librehr/ui";
import { getStoredSession } from "@/lib/auth";
import { getApiClient } from "@/lib/api-client";
import type {
  DocumentItem,
  DocumentCategory,
  BulkPayslipReport,
} from "@librehr/contracts";

export default function DocumentsPage() {
  const t = useTranslations("documents");

  const [documents, setDocuments] = React.useState<DocumentItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [categoryFilter, setCategoryFilter] = React.useState<string>("all");
  const [activeTab, setActiveTab] = React.useState<"list" | "upload" | "bulk">(
    "list",
  );

  // Single upload state
  const [title, setTitle] = React.useState("");
  const [category, setCategory] = React.useState<DocumentCategory>("contracts");
  const [audienceType, setAudienceType] = React.useState<
    "individual" | "company"
  >("individual");
  const [uploadFile, setUploadFile] = React.useState<File | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [successMsg, setSuccessMsg] = React.useState<string | null>(null);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  // Bulk payslip state
  const [bulkFiles, setBulkFiles] = React.useState<File[]>([]);
  const [bulkReport, setBulkReport] = React.useState<BulkPayslipReport | null>(
    null,
  );
  const [bulkProcessing, setBulkProcessing] = React.useState(false);

  // Document acknowledgements (DOC-006)
  const [acknowledgedDocs, setAcknowledgedDocs] = React.useState<Set<string>>(
    new Set(),
  );

  const handleAcknowledge = async (docId: string) => {
    const session = getStoredSession();
    if (!session?.token) return;
    try {
      const client = getApiClient(session.token);
      await client.acknowledgeDocument(docId);
      setAcknowledgedDocs((prev) => new Set([...prev, docId]));
    } catch {
      // handled
    }
  };

  const fetchDocuments = React.useCallback(async () => {
    const session = getStoredSession();
    if (!session?.token) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const client = getApiClient(session.token);
      const params =
        categoryFilter !== "all" ? { category: categoryFilter } : undefined;
      const res = await client.listDocuments(params);
      setDocuments(res);
    } catch (err) {
      console.error("Failed to load documents", err);
    } finally {
      setLoading(false);
    }
  }, [categoryFilter]);

  React.useEffect(() => {
    void fetchDocuments();
  }, [fetchDocuments]);

  const handleFileUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFile || !title) return;

    const session = getStoredSession();
    if (!session?.token) return;

    try {
      setUploading(true);
      setErrorMsg(null);
      setSuccessMsg(null);

      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const base64 = (reader.result as string).split(",")[1];
          if (!base64) throw new Error("Could not read file data");

          const client = getApiClient(session.token);
          await client.uploadDocument({
            title,
            category,
            audienceType,
            filename: uploadFile.name,
            mimeType: uploadFile.type || "application/octet-stream",
            fileDataBase64: base64,
          });

          setSuccessMsg(t("uploadSuccess"));
          setTitle("");
          setUploadFile(null);
          setActiveTab("list");
          void fetchDocuments();
        } catch (err: unknown) {
          setErrorMsg((err as Error).message || "Failed to upload document");
        } finally {
          setUploading(false);
        }
      };
      reader.readAsDataURL(uploadFile);
    } catch (err: unknown) {
      setErrorMsg((err as Error).message || "Failed to process file");
      setUploading(false);
    }
  };

  const handleDelete = async (id: string) => {
    const session = getStoredSession();
    if (!session?.token) return;

    if (!confirm("Are you sure you want to delete this document?")) return;

    try {
      const client = getApiClient(session.token);
      await client.deleteDocument(id);
      void fetchDocuments();
    } catch (err) {
      console.error("Failed to delete document", err);
    }
  };

  const handleBulkDryRun = async () => {
    if (bulkFiles.length === 0) return;
    const session = getStoredSession();
    if (!session?.token) return;

    try {
      setBulkProcessing(true);
      const fileDataPromises = bulkFiles.map(
        (f) =>
          new Promise<{
            filename: string;
            fileDataBase64: string;
            mimeType: string;
          }>((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => {
              const b64 = (r.result as string).split(",")[1] ?? "";
              resolve({
                filename: f.name,
                fileDataBase64: b64,
                mimeType: f.type || "application/pdf",
              });
            };
            r.onerror = reject;
            r.readAsDataURL(f);
          }),
      );

      const files = await Promise.all(fileDataPromises);
      const client = getApiClient(session.token);
      const report = await client.uploadBulkPayslips({ files, dryRun: true });
      setBulkReport(report);
    } catch (err) {
      console.error("Bulk match dry run failed", err);
    } finally {
      setBulkProcessing(false);
    }
  };

  const handleBulkCommit = async () => {
    if (bulkFiles.length === 0) return;
    const session = getStoredSession();
    if (!session?.token) return;

    try {
      setBulkProcessing(true);
      const fileDataPromises = bulkFiles.map(
        (f) =>
          new Promise<{
            filename: string;
            fileDataBase64: string;
            mimeType: string;
          }>((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => {
              const b64 = (r.result as string).split(",")[1] ?? "";
              resolve({
                filename: f.name,
                fileDataBase64: b64,
                mimeType: f.type || "application/pdf",
              });
            };
            r.onerror = reject;
            r.readAsDataURL(f);
          }),
      );

      const files = await Promise.all(fileDataPromises);
      const client = getApiClient(session.token);
      const report = await client.uploadBulkPayslips({ files, dryRun: false });
      setBulkReport(report);
      setSuccessMsg(`Processed ${report.matchedCount} payslips successfully.`);
      setActiveTab("list");
      void fetchDocuments();
    } catch (err) {
      console.error("Bulk upload commit failed", err);
    } finally {
      setBulkProcessing(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <FolderOpen className="h-7 w-7 text-primary" />
            {t("title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{t("subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={activeTab === "list" ? "default" : "outline"}
            size="sm"
            onClick={() => setActiveTab("list")}
          >
            <FileText className="h-4 w-4 mr-1.5" />
            {t("title")}
          </Button>
          <Button
            variant={activeTab === "upload" ? "default" : "outline"}
            size="sm"
            onClick={() => setActiveTab("upload")}
          >
            <Upload className="h-4 w-4 mr-1.5" />
            {t("upload")}
          </Button>
          <Button
            variant={activeTab === "bulk" ? "default" : "outline"}
            size="sm"
            onClick={() => setActiveTab("bulk")}
          >
            <FileSpreadsheet className="h-4 w-4 mr-1.5" />
            {t("bulkPayslips")}
          </Button>
        </div>
      </div>

      {successMsg && (
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-4 text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 shrink-0" />
          <span className="text-sm font-medium">{successMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 p-4 text-rose-800 dark:text-rose-300 flex items-center gap-2">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span className="text-sm font-medium">{errorMsg}</span>
        </div>
      )}

      {activeTab === "list" && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex items-center gap-2">
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="all">{t("filterAll")}</option>
              <option value="contracts">{t("categoryContracts")}</option>
              <option value="payslips">{t("categoryPayslips")}</option>
              <option value="certificates">{t("categoryCertificates")}</option>
              <option value="company_policies">{t("categoryPolicies")}</option>
              <option value="other">{t("categoryOther")}</option>
            </select>
          </div>

          {/* Documents Table */}
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            {loading ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                Loading documents...
              </div>
            ) : documents.length === 0 ? (
              <div className="p-12 text-center text-sm text-muted-foreground">
                {t("empty")}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-border bg-muted/50 text-xs font-medium text-muted-foreground uppercase">
                    <tr>
                      <th className="px-4 py-3">{t("colTitle")}</th>
                      <th className="px-4 py-3">{t("colCategory")}</th>
                      <th className="px-4 py-3">{t("colEmployee")}</th>
                      <th className="px-4 py-3">{t("colDate")}</th>
                      <th className="px-4 py-3">{t("colSize")}</th>
                      <th className="px-4 py-3 text-right">
                        {t("colActions")}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {documents.map((doc) => (
                      <tr key={doc.id} className="hover:bg-muted/30">
                        <td className="px-4 py-3 font-medium text-foreground">
                          <div className="flex items-center gap-2">
                            <FileText className="h-4 w-4 text-primary shrink-0" />
                            <div>
                              <div>{doc.title}</div>
                              <div className="text-xs text-muted-foreground">
                                {doc.latestFilename}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 capitalize text-muted-foreground">
                          {doc.category.replace("_", " ")}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {doc.employeeName ? (
                            <span className="flex items-center gap-1">
                              <Users className="h-3.5 w-3.5" />
                              {doc.employeeName}
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
                              {t("companyWide")}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {doc.createdAt.slice(0, 10)}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {(doc.latestSizeBytes / 1024).toFixed(1)} KB
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {(doc.category === "company_policies" ||
                              !doc.employeeName) &&
                              (acknowledgedDocs.has(doc.id) ? (
                                <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 bg-emerald-500/10 px-2 py-1 rounded font-medium">
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                  <span>Acknowledged</span>
                                </span>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs gap-1 text-primary border-primary/30 hover:bg-primary/10"
                                  onClick={() => handleAcknowledge(doc.id)}
                                >
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                  <span>Acknowledge</span>
                                </Button>
                              ))}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 px-2 text-rose-600 hover:text-rose-700"
                              onClick={() => handleDelete(doc.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === "upload" && (
        <div className="max-w-xl rounded-lg border border-border bg-card p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-foreground mb-4">
            {t("uploadTitle")}
          </h2>
          <form onSubmit={handleFileUpload} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                {t("documentTitle")}
              </label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Employment Contract 2026"
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                {t("selectCategory")}
              </label>
              <select
                value={category}
                onChange={(e) =>
                  setCategory(e.target.value as DocumentCategory)
                }
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="contracts">{t("categoryContracts")}</option>
                <option value="payslips">{t("categoryPayslips")}</option>
                <option value="certificates">
                  {t("categoryCertificates")}
                </option>
                <option value="company_policies">
                  {t("categoryPolicies")}
                </option>
                <option value="other">{t("categoryOther")}</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                Audience Scope
              </label>
              <select
                value={audienceType}
                onChange={(e) =>
                  setAudienceType(e.target.value as "individual" | "company")
                }
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="individual">{t("individual")}</option>
                <option value="company">{t("companyWide")}</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                {t("selectFile")}
              </label>
              <input
                type="file"
                required
                onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                className="w-full text-sm file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-primary file:text-primary-foreground hover:file:bg-primary/90"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Max 15MB. Supported: PDF, PNG, JPEG, TIFF, DOCX, XLSX.
              </p>
            </div>

            <Button
              type="submit"
              disabled={uploading || !uploadFile}
              className="w-full"
            >
              {uploading ? t("uploading") : t("upload")}
            </Button>
          </form>
        </div>
      )}

      {activeTab === "bulk" && (
        <div className="max-w-3xl rounded-lg border border-border bg-card p-6 shadow-sm space-y-6">
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              {t("bulkUploadTitle")}
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              {t("bulkUploadDesc")}
            </p>
          </div>

          <div>
            <input
              type="file"
              multiple
              accept="application/pdf"
              onChange={(e) => setBulkFiles(Array.from(e.target.files ?? []))}
              className="w-full text-sm file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-primary file:text-primary-foreground hover:file:bg-primary/90"
            />
            <p className="text-xs text-muted-foreground mt-1">
              {bulkFiles.length} files selected. Filenames can include DNI/NIE
              (e.g. 12345678Z-2026-03.pdf) or employee names.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              onClick={handleBulkDryRun}
              disabled={bulkProcessing || bulkFiles.length === 0}
            >
              Test Match (Dry Run)
            </Button>
            <Button
              onClick={handleBulkCommit}
              disabled={bulkProcessing || bulkFiles.length === 0}
            >
              {t("processUpload")}
            </Button>
          </div>

          {bulkReport && (
            <div className="space-y-4 pt-4 border-t border-border">
              <div className="flex items-center gap-4 text-sm">
                <div>
                  Total Files:{" "}
                  <span className="font-semibold">{bulkReport.totalFiles}</span>
                </div>
                <div className="text-emerald-600 font-medium">
                  Matched: {bulkReport.matchedCount}
                </div>
                <div className="text-rose-600 font-medium">
                  Unmatched: {bulkReport.unmatchedCount}
                </div>
              </div>

              <div className="overflow-x-auto rounded border border-border">
                <table className="w-full text-left text-xs">
                  <thead className="bg-muted/50 font-medium text-muted-foreground uppercase border-b border-border">
                    <tr>
                      <th className="px-3 py-2">Filename</th>
                      <th className="px-3 py-2">Matched Employee</th>
                      <th className="px-3 py-2">Period</th>
                      <th className="px-3 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {bulkReport.matches.map((m, idx) => (
                      <tr key={idx} className="hover:bg-muted/30">
                        <td className="px-3 py-2 font-mono">{m.filename}</td>
                        <td className="px-3 py-2">{m.employeeName ?? "—"}</td>
                        <td className="px-3 py-2">
                          {m.periodYearMonth ?? "—"}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium ${
                              m.status === "matched"
                                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                                : "bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300"
                            }`}
                          >
                            {m.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
