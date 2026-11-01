"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  UserCheck,
  CheckCircle2,
  Circle,
  FileSpreadsheet,
  Calendar,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@openhr/ui";
import { getStoredSession } from "@/lib/auth";
import { getApiClient } from "@/lib/api-client";
import type {
  ChecklistInstance,
  ChecklistTemplate,
  EmployeeImportValidationResponse,
} from "@openhr/contracts";

export default function OnboardingPage() {
  const t = useTranslations("onboarding");

  const [activeTab, setActiveTab] = React.useState<"checklists" | "import">(
    "checklists",
  );
  const [instances, setInstances] = React.useState<ChecklistInstance[]>([]);
  const [_templates, setTemplates] = React.useState<ChecklistTemplate[]>([]);
  const [selectedInstanceId, setSelectedInstanceId] = React.useState<
    string | null
  >(null);
  const [loading, setLoading] = React.useState(true);

  // Bulk import state
  const [csvContent, setCsvContent] = React.useState("");
  const [importReport, setImportReport] =
    React.useState<EmployeeImportValidationResponse | null>(null);
  const [validating, setValidating] = React.useState(false);
  const [importSuccess, setImportSuccess] = React.useState<string | null>(null);

  const fetchChecklists = React.useCallback(async () => {
    const session = getStoredSession();
    if (!session?.token) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const client = getApiClient(session.token);
      const [insts, tmpls] = await Promise.all([
        client.listChecklistInstances(),
        client.listChecklistTemplates(),
      ]);
      setInstances(insts);
      setTemplates(tmpls);
      if (insts.length > 0 && !selectedInstanceId) {
        setSelectedInstanceId(insts[0]?.id ?? null);
      }
    } catch (err) {
      console.error("Failed to load checklists", err);
    } finally {
      setLoading(false);
    }
  }, [selectedInstanceId]);

  React.useEffect(() => {
    void fetchChecklists();
  }, [fetchChecklists]);

  const handleToggleTask = async (taskId: string, isCompleted: boolean) => {
    const session = getStoredSession();
    if (!session?.token) return;

    try {
      const client = getApiClient(session.token);
      await client.toggleChecklistTask(taskId, isCompleted);
      void fetchChecklists();
    } catch (err) {
      console.error("Failed to toggle task", err);
    }
  };

  const handleValidateCsv = async (dryRun: boolean) => {
    if (!csvContent.trim()) return;
    const session = getStoredSession();
    if (!session?.token) return;

    try {
      setValidating(true);
      setImportSuccess(null);
      const client = getApiClient(session.token);
      const res = await client.importEmployeesCsv(csvContent, dryRun);
      setImportReport(res);
      if (!dryRun && res.valid) {
        setImportSuccess(t("importSuccess", { count: res.importedCount ?? 0 }));
        setCsvContent("");
      }
    } catch (err) {
      console.error("CSV import failed", err);
    } finally {
      setValidating(false);
    }
  };

  const selectedInstance = instances.find((i) => i.id === selectedInstanceId);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <UserCheck className="h-7 w-7 text-primary" />
            {t("title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{t("subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={activeTab === "checklists" ? "default" : "outline"}
            size="sm"
            onClick={() => setActiveTab("checklists")}
          >
            <UserCheck className="h-4 w-4 mr-1.5" />
            {t("tabChecklists")}
          </Button>
          <Button
            variant={activeTab === "import" ? "default" : "outline"}
            size="sm"
            onClick={() => setActiveTab("import")}
          >
            <FileSpreadsheet className="h-4 w-4 mr-1.5" />
            {t("tabImport")}
          </Button>
        </div>
      </div>

      {activeTab === "checklists" && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Checklists List */}
          <div className="space-y-3 md:col-span-1">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              {t("tabChecklists")}
            </h2>
            {loading ? (
              <div className="p-4 text-sm text-muted-foreground">
                Loading...
              </div>
            ) : instances.length === 0 ? (
              <div className="rounded-lg border border-border p-6 text-center text-sm text-muted-foreground bg-card">
                {t("emptyChecklists")}
              </div>
            ) : (
              instances.map((inst) => {
                const percent =
                  inst.totalTasks > 0
                    ? Math.round((inst.completedTasks / inst.totalTasks) * 100)
                    : 0;
                const isSelected = inst.id === selectedInstanceId;

                return (
                  <div
                    key={inst.id}
                    onClick={() => setSelectedInstanceId(inst.id)}
                    className={`cursor-pointer rounded-lg border p-4 transition-colors ${
                      isSelected
                        ? "border-primary bg-primary/5"
                        : "border-border bg-card hover:bg-muted/30"
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <h3 className="font-medium text-foreground text-sm">
                        {inst.title}
                      </h3>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                          inst.status === "completed"
                            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                            : "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300"
                        }`}
                      >
                        {inst.status === "completed"
                          ? t("statusCompleted")
                          : t("statusInProgress")}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                      <Calendar className="h-3.5 w-3.5" />
                      <span>{inst.baseDate}</span>
                    </div>
                    <div className="mt-3">
                      <div className="flex justify-between text-xs text-muted-foreground mb-1">
                        <span>{t("colProgress")}</span>
                        <span>
                          {inst.completedTasks}/{inst.totalTasks} ({percent}%)
                        </span>
                      </div>
                      <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full transition-all"
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Checklist Tasks Detail View */}
          <div className="md:col-span-2 space-y-4">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              {t("tasksTitle")}
            </h2>
            {selectedInstance ? (
              <div className="rounded-lg border border-border bg-card p-6 shadow-sm space-y-4">
                <div>
                  <h3 className="text-lg font-semibold text-foreground">
                    {selectedInstance.title}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Target Date: {selectedInstance.baseDate}
                  </p>
                </div>

                <div className="divide-y divide-border rounded-lg border border-border">
                  {(selectedInstance.tasks ?? []).length === 0 ? (
                    <div className="p-6 text-center text-sm text-muted-foreground">
                      No tasks defined for this checklist.
                    </div>
                  ) : (
                    selectedInstance.tasks?.map((task) => (
                      <div
                        key={task.id}
                        className="flex items-start justify-between p-4 hover:bg-muted/20"
                      >
                        <div className="flex items-start gap-3">
                          <button
                            type="button"
                            onClick={() =>
                              handleToggleTask(task.id, !task.isCompleted)
                            }
                            className="mt-0.5 text-muted-foreground hover:text-primary transition-colors"
                          >
                            {task.isCompleted ? (
                              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                            ) : (
                              <Circle className="h-5 w-5" />
                            )}
                          </button>
                          <div>
                            <div
                              className={`text-sm font-medium ${
                                task.isCompleted
                                  ? "line-through text-muted-foreground"
                                  : "text-foreground"
                              }`}
                            >
                              {task.title}
                            </div>
                            {task.description && (
                              <div className="text-xs text-muted-foreground mt-0.5">
                                {task.description}
                              </div>
                            )}
                            <div className="flex items-center gap-2 mt-1 text-[11px] text-muted-foreground">
                              <span className="capitalize font-medium text-foreground">
                                Role: {task.assignedRole}
                              </span>
                              <span>•</span>
                              <span>Due: {task.dueDate}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
                Select a checklist to view its tasks.
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === "import" && (
        <div className="max-w-3xl rounded-lg border border-border bg-card p-6 shadow-sm space-y-6">
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              {t("importTitle")}
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              {t("importDesc")}
            </p>
          </div>

          {importSuccess && (
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-4 text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 shrink-0" />
              <span className="text-sm font-medium">{importSuccess}</span>
            </div>
          )}

          <div className="space-y-2">
            <textarea
              rows={8}
              value={csvContent}
              onChange={(e) => setCsvContent(e.target.value)}
              placeholder="first_name,last_name,email,tax_id,hire_date,job_title,department_name&#10;Maria,Garcia,maria@example.com,12345678Z,2026-03-01,Product Designer,Engineering"
              className="w-full rounded-md border border-input bg-background p-3 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <p className="text-xs text-muted-foreground">
              Required headers:{" "}
              <code className="bg-muted px-1 py-0.5 rounded">
                first_name, last_name, email
              </code>
              . Optional:{" "}
              <code className="bg-muted px-1 py-0.5 rounded">
                tax_id, iban, hire_date, job_title, department_name
              </code>
              .
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              disabled={validating || !csvContent.trim()}
              onClick={() => handleValidateCsv(true)}
            >
              {t("validateCsv")}
            </Button>
            <Button
              disabled={validating || !csvContent.trim()}
              onClick={() => handleValidateCsv(false)}
            >
              {t("applyImport")}
            </Button>
          </div>

          {importReport && (
            <div className="space-y-4 pt-4 border-t border-border">
              <div className="flex items-center gap-4 text-sm">
                <div>
                  Total Rows:{" "}
                  <span className="font-semibold">
                    {importReport.totalRows}
                  </span>
                </div>
                <div className="text-emerald-600 font-medium">
                  Valid: {importReport.validRowsCount}
                </div>
                <div className="text-rose-600 font-medium">
                  Errors: {importReport.errors.length}
                </div>
              </div>

              {importReport.errors.length > 0 && (
                <div className="rounded-md border border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/30 p-4 space-y-2">
                  <h4 className="text-xs font-semibold text-rose-800 dark:text-rose-300 flex items-center gap-1.5">
                    <AlertTriangle className="h-4 w-4" />
                    Validation Errors (Import Prevented)
                  </h4>
                  <ul className="list-disc pl-5 text-xs text-rose-700 dark:text-rose-300 space-y-1">
                    {importReport.errors.map((err, idx) => (
                      <li key={idx}>
                        Row {err.row}:{" "}
                        <span className="font-semibold">{err.field}</span> —{" "}
                        {err.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
