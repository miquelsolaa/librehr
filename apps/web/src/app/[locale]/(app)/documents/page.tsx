"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  FileText,
  Upload,
  Trash2,
  Users,
  CheckCircle2,
  AlertCircle,
  FileSpreadsheet,
  FileSignature,
  Plus,
  Wand2,
} from "lucide-react";
import {
  Button,
  PageHeader,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@librehr/ui";
import { getStoredSession } from "@/lib/auth";
import { getApiClient } from "@/lib/api-client";
import type {
  DocumentItem,
  DocumentCategory,
  BulkPayslipReport,
  DocumentTemplate,
  EmployeeListItem,
} from "@librehr/contracts";

export default function DocumentsPage() {
  const t = useTranslations("documents");

  const categoryLabel = (value: string): string => {
    switch (value) {
      case "contracts":
        return t("categoryContracts");
      case "payslips":
        return t("categoryPayslips");
      case "certificates":
        return t("categoryCertificates");
      case "company_policies":
        return t("categoryPolicies");
      case "other":
        return t("categoryOther");
      default:
        return value;
    }
  };

  const [documents, setDocuments] = React.useState<DocumentItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<
    "signInRequired" | "loadError" | null
  >(null);
  const [templateLoadError, setTemplateLoadError] = React.useState(false);
  const [categoryFilter, setCategoryFilter] = React.useState<string>("all");
  const [activeTab, setActiveTab] = React.useState<
    "list" | "upload" | "bulk" | "templates"
  >("list");

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

  // Document templates state (DOC-007)
  const [templates, setTemplates] = React.useState<DocumentTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = React.useState(false);
  const [isNewTemplateOpen, setIsNewTemplateOpen] = React.useState(false);
  const [newTemplateName, setNewTemplateName] = React.useState("");
  const [newTemplateCategory, setNewTemplateCategory] =
    React.useState("certificates");
  const [newTemplateContent, setNewTemplateContent] = React.useState("");
  const [isGeneratingOpen, setIsGeneratingOpen] = React.useState(false);
  const [selectedTemplate, setSelectedTemplate] =
    React.useState<DocumentTemplate | null>(null);
  const [employeesList, setEmployeesList] = React.useState<EmployeeListItem[]>(
    [],
  );
  const [selectedEmployeeId, setSelectedEmployeeId] = React.useState("");
  const [renderedPreview, setRenderedPreview] = React.useState<string | null>(
    null,
  );
  const [saveAsDoc, setSaveAsDoc] = React.useState(true);
  const [isTemplateSubmitting, setIsTemplateSubmitting] = React.useState(false);

  // Document acknowledgements (DOC-006)
  const [acknowledgedDocs, setAcknowledgedDocs] = React.useState<Set<string>>(
    new Set(),
  );

  const handleAcknowledge = async (docId: string) => {
    const session = getStoredSession();
    if (!session) {
      setErrorMsg(t("signInRequired"));
      return;
    }
    try {
      const client = getApiClient();
      await client.acknowledgeDocument(docId);
      setAcknowledgedDocs((prev) => new Set([...prev, docId]));
    } catch {
      setErrorMsg(t("acknowledgeError"));
    }
  };

  const fetchDocuments = React.useCallback(async () => {
    const session = getStoredSession();
    if (!session) {
      setDocuments([]);
      setLoadError("signInRequired");
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setLoadError(null);
      const client = getApiClient();
      const params =
        categoryFilter !== "all" ? { category: categoryFilter } : undefined;
      const res = await client.listDocuments(params);
      setDocuments(res);
    } catch {
      setDocuments([]);
      setLoadError("loadError");
    } finally {
      setLoading(false);
    }
  }, [categoryFilter]);

  const fetchTemplates = React.useCallback(async () => {
    const session = getStoredSession();
    if (!session) {
      setErrorMsg(t("signInRequired"));
      return;
    }
    try {
      setTemplatesLoading(true);
      setTemplateLoadError(false);
      const client = getApiClient();
      const [tList, empRes] = await Promise.all([
        client.listDocumentTemplates(),
        client.listEmployees({ pageSize: 100 }),
      ]);
      setTemplates(tList);
      setEmployeesList(empRes.items);
      if (empRes.items.length > 0 && !selectedEmployeeId) {
        setSelectedEmployeeId(empRes.items[0]!.id);
      }
    } catch {
      setTemplates([]);
      setEmployeesList([]);
      setTemplateLoadError(true);
    } finally {
      setTemplatesLoading(false);
    }
  }, [selectedEmployeeId]);

  React.useEffect(() => {
    void fetchDocuments();
  }, [fetchDocuments]);

  React.useEffect(() => {
    if (activeTab === "templates") {
      void fetchTemplates();
    }
  }, [activeTab, fetchTemplates]);

  const handleCreateTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    const session = getStoredSession();
    if (!session) {
      setErrorMsg(t("signInRequired"));
      return;
    }
    if (!newTemplateName || !newTemplateContent) return;

    try {
      setIsTemplateSubmitting(true);
      const client = getApiClient();
      await client.createDocumentTemplate({
        name: newTemplateName.trim(),
        category: newTemplateCategory,
        content: newTemplateContent,
      });

      setIsNewTemplateOpen(false);
      setNewTemplateName("");
      setNewTemplateContent("");
      setSuccessMsg(t("templateCreatedSuccess"));
      void fetchTemplates();
    } catch {
      setErrorMsg(t("templateCreateError"));
    } finally {
      setIsTemplateSubmitting(false);
    }
  };

  const closeGenerateDialog = () => {
    setIsGeneratingOpen(false);
    setSelectedTemplate(null);
    setRenderedPreview(null);
  };

  const handleRenderPreview = async () => {
    if (!selectedTemplate || !selectedEmployeeId) return;
    const session = getStoredSession();
    if (!session) {
      setErrorMsg(t("signInRequired"));
      return;
    }

    try {
      setIsTemplateSubmitting(true);
      const client = getApiClient();
      const res = await client.renderDocumentTemplate(selectedTemplate.id, {
        employeeId: selectedEmployeeId,
        saveAsDocument: saveAsDoc,
      });

      setRenderedPreview(res.renderedContent);
      if (saveAsDoc && res.documentId) {
        setSuccessMsg(t("documentGeneratedSuccess"));
        void fetchDocuments();
      }
    } catch {
      setErrorMsg(t("documentGenerateError"));
    } finally {
      setIsTemplateSubmitting(false);
    }
  };

  const handleDeleteTemplate = async (templateId: string) => {
    if (!window.confirm(t("deleteTemplateConfirm"))) return;
    const session = getStoredSession();
    if (!session) {
      setErrorMsg(t("signInRequired"));
      return;
    }

    try {
      const client = getApiClient();
      await client.deleteDocumentTemplate(templateId);
      void fetchTemplates();
      setSuccessMsg(t("templateDeletedSuccess"));
    } catch {
      setErrorMsg(t("templateDeleteError"));
    }
  };

  const handleFileUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFile || !title) return;

    const session = getStoredSession();
    if (!session) {
      setErrorMsg(t("signInRequired"));
      return;
    }

    try {
      setUploading(true);
      setErrorMsg(null);
      setSuccessMsg(null);

      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const base64 = (reader.result as string).split(",")[1];
          if (!base64) throw new Error("Could not read file data");

          const client = getApiClient();
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
        } catch {
          setErrorMsg(t("uploadError"));
        } finally {
          setUploading(false);
        }
      };
      reader.onerror = () => {
        setErrorMsg(t("uploadError"));
        setUploading(false);
      };
      reader.readAsDataURL(uploadFile);
    } catch {
      setErrorMsg(t("uploadError"));
      setUploading(false);
    }
  };

  const handleDelete = async (id: string) => {
    const session = getStoredSession();
    if (!session) {
      setErrorMsg(t("signInRequired"));
      return;
    }

    if (!confirm(t("deleteConfirm"))) return;

    try {
      const client = getApiClient();
      await client.deleteDocument(id);
      void fetchDocuments();
    } catch {
      setErrorMsg(t("deleteError"));
    }
  };

  const handleBulkDryRun = async () => {
    if (bulkFiles.length === 0) return;
    const session = getStoredSession();
    if (!session) {
      setErrorMsg(t("signInRequired"));
      return;
    }

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
      const client = getApiClient();
      const report = await client.uploadBulkPayslips({ files, dryRun: true });
      setBulkReport(report);
    } catch {
      setErrorMsg(t("bulkError"));
    } finally {
      setBulkProcessing(false);
    }
  };

  const handleBulkCommit = async () => {
    if (bulkFiles.length === 0) return;
    const session = getStoredSession();
    if (!session) {
      setErrorMsg(t("signInRequired"));
      return;
    }

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
      const client = getApiClient();
      const report = await client.uploadBulkPayslips({ files, dryRun: false });
      setBulkReport(report);
      setSuccessMsg(t("bulkSuccess", { count: report.matchedCount }));
      setActiveTab("list");
      void fetchDocuments();
    } catch {
      setErrorMsg(t("bulkError"));
    } finally {
      setBulkProcessing(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          <>
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
            <Button
              variant={activeTab === "templates" ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveTab("templates")}
            >
              <FileSignature className="h-4 w-4 mr-1.5" />
              {t("templatesTab")}
            </Button>
          </>
        }
      />

      {successMsg && (
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-4 text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 shrink-0" />
          <span className="text-sm font-medium">{successMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div
          role="alert"
          className="rounded-lg border border-rose-500/20 bg-rose-500/10 p-4 text-rose-800 dark:text-rose-300 flex items-center gap-2"
        >
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span className="text-sm font-medium">{errorMsg}</span>
        </div>
      )}

      {activeTab === "list" && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex items-center gap-2">
            <select
              aria-label={t("selectCategory")}
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="h-9 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
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
          <div className="overflow-hidden rounded-lg border border-border bg-surface">
            {loading ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                {t("loading")}
              </div>
            ) : loadError ? (
              <div role="alert" className="space-y-3 p-8 text-center text-sm">
                <p>{t(loadError)}</p>
                {loadError === "loadError" && (
                  <Button
                    variant="outline"
                    onClick={() => void fetchDocuments()}
                  >
                    {t("retry")}
                  </Button>
                )}
              </div>
            ) : documents.length === 0 ? (
              <div className="p-12 text-center text-sm text-muted-foreground">
                {t("empty")}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-border bg-surface text-xs font-medium text-muted-foreground uppercase">
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
                      <tr key={doc.id} className="hover:bg-surface">
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
                        <td className="px-4 py-3 text-muted-foreground">
                          {categoryLabel(doc.category)}
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
                                <span className="inline-flex items-center gap-1 text-xs text-emerald-600 bg-emerald-500/10 px-2 py-1 rounded font-medium">
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                  <span>{t("acknowledged")}</span>
                                </span>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs gap-1 text-primary border-primary/30 hover:bg-primary/10"
                                  onClick={() => handleAcknowledge(doc.id)}
                                >
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                  <span>{t("acknowledge")}</span>
                                </Button>
                              ))}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 px-2 text-rose-600 hover:text-rose-700"
                              aria-label={t("deleteDocument", {
                                title: doc.title,
                              })}
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
        <div className="max-w-xl rounded-lg border border-border bg-surface p-6 shadow-sm">
          <h2 className="mb-4 text-base font-semibold text-foreground">
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
                placeholder={t("documentTitlePlaceholder")}
                className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
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
                className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
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
                {t("audienceScope")}
              </label>
              <select
                value={audienceType}
                onChange={(e) =>
                  setAudienceType(e.target.value as "individual" | "company")
                }
                className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
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
                {t("fileHint")}
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
        <div className="max-w-3xl rounded-lg border border-border bg-surface p-6 shadow-sm space-y-6">
          <div>
            <h2 className="text-base font-semibold text-foreground">
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
              {t("bulkFilesSelected", { count: bulkFiles.length })}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              onClick={handleBulkDryRun}
              disabled={bulkProcessing || bulkFiles.length === 0}
            >
              {t("bulkDryRun")}
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
                  {t("bulkTotalFiles")}:{" "}
                  <span className="font-semibold">{bulkReport.totalFiles}</span>
                </div>
                <div className="text-emerald-600 font-medium">
                  {t("matched")}: {bulkReport.matchedCount}
                </div>
                <div className="text-rose-600 font-medium">
                  {t("unmatched")}: {bulkReport.unmatchedCount}
                </div>
              </div>

              <div className="overflow-x-auto rounded border border-border">
                <table className="w-full text-left text-xs">
                  <thead className="bg-surface font-medium text-muted-foreground uppercase border-b border-border">
                    <tr>
                      <th className="px-3 py-2">{t("colFilename")}</th>
                      <th className="px-3 py-2">{t("colMatchedEmployee")}</th>
                      <th className="px-3 py-2">{t("colPeriod")}</th>
                      <th className="px-3 py-2">{t("matchStatus")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {bulkReport.matches.map((m, idx) => (
                      <tr key={idx} className="hover:bg-surface">
                        <td className="px-3 py-2 font-mono">{m.filename}</td>
                        <td className="px-3 py-2">{m.employeeName ?? "—"}</td>
                        <td className="px-3 py-2">
                          {m.periodYearMonth ?? "—"}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`inline-flex px-1.5 py-0.5 rounded text-xs font-medium ${
                              m.status === "matched"
                                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                                : "bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300"
                            }`}
                          >
                            {m.status === "matched"
                              ? t("matched")
                              : t("unmatched")}
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

      {/* Templates Tab (DOC-007) */}
      {activeTab === "templates" && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-foreground">
                {t("templatesListTitle")}
              </h2>
              <p className="text-xs text-muted-foreground">
                {t("templatesListSubtitle")}
              </p>
            </div>
            <Button
              size="sm"
              onClick={() => setIsNewTemplateOpen(true)}
              className="flex items-center gap-1.5"
            >
              <Plus className="h-4 w-4" />
              {t("newTemplateButton")}
            </Button>
          </div>

          {templatesLoading ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              {t("loadingTemplates")}
            </div>
          ) : templateLoadError ? (
            <div role="alert" className="space-y-3 p-8 text-center text-sm">
              <p>{t("templatesLoadError")}</p>
              <Button variant="outline" onClick={() => void fetchTemplates()}>
                {t("retry")}
              </Button>
            </div>
          ) : templates.length === 0 ? (
            <div className="rounded-card border border-dashed border-border p-12 text-center space-y-3">
              <FileSignature className="mx-auto h-10 w-10 text-muted-foreground/60" />
              <h3 className="text-sm font-semibold text-foreground">
                {t("noTemplatesTitle")}
              </h3>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                {t("noTemplatesDescription")}
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setNewTemplateName(t("sampleTemplateName"));
                  setNewTemplateCategory("certificates");
                  // Merge tags are passed as arguments so the ICU parser leaves them intact.
                  setNewTemplateContent(
                    t("sampleTemplateContent", {
                      name: "{{employee.name}}",
                      dni: "{{employee.dni}}",
                      org: "{{organization.name}}",
                      jobTitle: "{{employee.job_title}}",
                      department: "{{employee.department}}",
                      hireDate: "{{employee.hire_date}}",
                      currentDate: "{{current_date}}",
                    }),
                  );
                  setIsNewTemplateOpen(true);
                }}
              >
                {t("loadSampleTemplate")}
              </Button>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {templates.map((tpl) => (
                <div
                  key={tpl.id}
                  className="rounded-card border border-border bg-surface p-5 shadow-xs flex flex-col justify-between space-y-4 hover:border-primary/40 transition-colors"
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-semibold text-foreground text-sm line-clamp-1">
                        {tpl.name}
                      </h3>
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary shrink-0 uppercase tracking-wider">
                        {categoryLabel(tpl.category)}
                      </span>
                    </div>
                    {tpl.description && (
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        {tpl.description}
                      </p>
                    )}
                    <pre className="rounded bg-background p-2 font-mono text-xs text-muted-foreground max-h-24 overflow-hidden border border-border/50">
                      {tpl.content}
                    </pre>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-border">
                    <Button
                      size="sm"
                      onClick={() => {
                        setSelectedTemplate(tpl);
                        setRenderedPreview(null);
                        setIsGeneratingOpen(true);
                      }}
                      className="flex items-center gap-1.5 text-xs h-8"
                    >
                      <Wand2 className="h-3.5 w-3.5" />
                      {t("generateFromTemplate")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleDeleteTemplate(tpl.id)}
                      className="h-8 text-danger hover:bg-danger/10 border-danger/20 p-2"
                      title={t("deleteTemplate")}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <Dialog
            open={isNewTemplateOpen}
            onOpenChange={(open) => {
              if (!open && !isTemplateSubmitting) setIsNewTemplateOpen(false);
            }}
          >
            <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{t("createNewTemplateTitle")}</DialogTitle>
                <DialogDescription>
                  {t("createNewTemplateSubtitle")}
                </DialogDescription>
              </DialogHeader>

              <form onSubmit={handleCreateTemplate} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1">
                      {t("templateNameLabel")} *
                    </label>
                    <input
                      type="text"
                      required
                      value={newTemplateName}
                      onChange={(e) => setNewTemplateName(e.target.value)}
                      placeholder={t("templateNamePlaceholder")}
                      className="w-full rounded-input border border-border bg-surface px-3 py-2 text-sm text-foreground focus:ring-1 focus:ring-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1">
                      {t("category")} *
                    </label>
                    <select
                      value={newTemplateCategory}
                      onChange={(e) => setNewTemplateCategory(e.target.value)}
                      className="w-full rounded-input border border-border bg-surface px-3 py-2 text-sm text-foreground focus:ring-1 focus:ring-primary"
                    >
                      <option value="contracts">
                        {t("categoryContracts")}
                      </option>
                      <option value="certificates">
                        {t("categoryCertificates")}
                      </option>
                      <option value="company_policies">
                        {t("categoryPolicies")}
                      </option>
                      <option value="other">{t("categoryOther")}</option>
                    </select>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-medium text-foreground">
                      {t("templateContentMarkdown")} *
                    </label>
                    <span className="text-xs text-muted-foreground">
                      {t("markdownHint")}
                    </span>
                  </div>
                  <textarea
                    required
                    rows={8}
                    value={newTemplateContent}
                    onChange={(e) => setNewTemplateContent(e.target.value)}
                    placeholder={t("templateContentPlaceholder", {
                      name: "{{employee.name}}",
                      org: "{{organization.name}}",
                    })}
                    className="w-full rounded-input border border-border bg-surface p-3 font-mono text-xs text-foreground focus:ring-1 focus:ring-primary"
                  />
                </div>

                {/* Cheat sheet of merge fields */}
                <div className="rounded-input border border-border bg-surface p-3 text-xs space-y-1.5">
                  <div className="font-semibold text-foreground text-xs uppercase tracking-wider">
                    {t("availableMergeFields")}
                  </div>
                  <div className="flex flex-wrap gap-1.5 font-mono text-xs text-primary">
                    {[
                      "{{employee.name}}",
                      "{{employee.dni}}",
                      "{{employee.job_title}}",
                      "{{employee.department}}",
                      "{{employee.hire_date}}",
                      "{{employee.email}}",
                      "{{organization.name}}",
                      "{{current_date}}",
                    ].map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        onClick={() =>
                          setNewTemplateContent((prev) => `${prev} ${tag}`)
                        }
                        className="rounded bg-background px-1.5 py-0.5 border border-border hover:border-primary/50 cursor-pointer"
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsNewTemplateOpen(false)}
                    disabled={isTemplateSubmitting}
                  >
                    {t("cancel")}
                  </Button>
                  <Button type="submit" isLoading={isTemplateSubmitting}>
                    {t("saveTemplateButton")}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>

          <Dialog
            open={isGeneratingOpen && selectedTemplate !== null}
            onOpenChange={(open) => {
              if (!open) closeGenerateDialog();
            }}
          >
            {selectedTemplate && (
              <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Wand2
                      className="h-5 w-5 text-primary"
                      aria-hidden="true"
                    />
                    {t("generateModalTitle")}: {selectedTemplate.name}
                  </DialogTitle>
                  <DialogDescription>
                    {t("generateModalSubtitle")}
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1">
                      {t("selectEmployee")} *
                    </label>
                    <select
                      value={selectedEmployeeId}
                      onChange={(e) => {
                        setSelectedEmployeeId(e.target.value);
                        setRenderedPreview(null);
                      }}
                      className="w-full rounded-input border border-border bg-surface px-3 py-2 text-sm text-foreground focus:ring-1 focus:ring-primary"
                    >
                      {employeesList.map((emp) => (
                        <option key={emp.id} value={emp.id}>
                          {emp.firstName} {emp.lastName} —{" "}
                          {emp.jobTitle ?? emp.departmentName ?? emp.email}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-center justify-between rounded-input border border-border bg-surface p-3">
                    <div>
                      <div className="text-xs font-medium text-foreground">
                        {t("saveAsDocumentCheckbox")}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {t("saveAsDocumentHint")}
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={saveAsDoc}
                      onChange={(e) => setSaveAsDoc(e.target.checked)}
                      className="h-4 w-4 rounded border-border text-primary focus:ring-primary cursor-pointer"
                    />
                  </div>

                  {/* Rendered Preview Box */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-xs font-medium text-foreground">
                        {t("renderedPreview")}
                      </label>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleRenderPreview}
                        isLoading={isTemplateSubmitting}
                        className="h-7 text-xs"
                      >
                        {t("previewMergeButton")}
                      </Button>
                    </div>
                    <div className="rounded-input border border-border bg-surface p-4 font-mono text-xs text-foreground max-h-56 overflow-y-auto whitespace-pre-wrap select-all">
                      {renderedPreview ?? t("previewPlaceholder")}
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-2 border-t border-border">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={closeGenerateDialog}
                    >
                      {t("close")}
                    </Button>
                    <Button
                      type="button"
                      onClick={handleRenderPreview}
                      isLoading={isTemplateSubmitting}
                    >
                      {saveAsDoc
                        ? t("generateAndSaveButton")
                        : t("generatePreviewButton")}
                    </Button>
                  </div>
                </div>
              </DialogContent>
            )}
          </Dialog>
        </div>
      )}
    </div>
  );
}
