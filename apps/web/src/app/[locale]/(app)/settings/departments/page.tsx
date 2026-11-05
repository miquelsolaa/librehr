"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Building2, Plus, ArrowLeft } from "lucide-react";
import {
  Button,
  Input,
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@librehr/ui";
import { DepartmentCoverageForm } from "@/components/department-coverage-form";
import { apiClient } from "../../../../../lib/api-client.js";
import type { Department } from "@librehr/contracts";

export default function DepartmentsSettingsPage() {
  const params = useParams();
  const locale = (params?.["locale"] as string) ?? "es";
  const t = useTranslations("settings");
  const tCommon = useTranslations("common");

  const [departments, setDepartments] = React.useState<Department[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState(false);
  const [actionError, setActionError] = React.useState(false);

  // Dialog state
  const [createOpen, setCreateOpen] = React.useState(false);
  const [deptName, setDeptName] = React.useState("");
  const [parentId, setParentId] = React.useState<string>("");
  const [submitting, setSubmitting] = React.useState(false);

  const loadDepartments = React.useCallback(async () => {
    try {
      setLoading(true);
      setLoadError(false);
      const res = await apiClient.listDepartments();
      setDepartments(res);
    } catch {
      setDepartments([]);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadDepartments();
  }, [loadDepartments]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setActionError(false);
    try {
      await apiClient.createDepartment({
        name: deptName,
        parentId: parentId || undefined,
      });
      setDeptName("");
      setParentId("");
      setCreateOpen(false);
      loadDepartments();
    } catch {
      setActionError(true);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <Link
            href={`/${locale}/settings`}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Settings</span>
          </Link>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {t("departmentsTitle")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("departmentsDescription")}
          </p>
        </div>

        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              <span>{t("addDepartment")}</span>
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("addDepartment")}</DialogTitle>
              <DialogDescription>
                Define a new department within your organization structure.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleCreate} className="space-y-4">
              {actionError && (
                <p role="alert" className="text-sm text-danger">
                  {t("actionError")}
                </p>
              )}
              <div className="space-y-1.5">
                <label
                  htmlFor="dept-name"
                  className="text-xs font-medium text-foreground"
                >
                  {t("departmentName")}
                </label>
                <Input
                  id="dept-name"
                  required
                  placeholder="e.g. Product Design"
                  value={deptName}
                  onChange={(e) => setDeptName(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="parent-dept"
                  className="text-xs font-medium text-foreground"
                >
                  {t("parentDepartment")}
                </label>
                <select
                  id="parent-dept"
                  className="flex h-10 w-full rounded-input border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                  value={parentId}
                  onChange={(e) => setParentId(e.target.value)}
                >
                  <option value="">None (Top-level)</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setCreateOpen(false)}
                >
                  {tCommon("cancel")}
                </Button>
                <Button type="submit" disabled={submitting}>
                  {submitting ? tCommon("loading") : tCommon("save")}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="rounded-card border border-border bg-surface divide-y divide-border">
        {loading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            {tCommon("loading")}
          </div>
        ) : loadError ? (
          <div role="alert" className="space-y-3 p-8 text-center text-sm">
            <p>{t("loadError")}</p>
            <Button variant="outline" onClick={() => void loadDepartments()}>
              {t("retry")}
            </Button>
          </div>
        ) : departments.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No departments defined yet. Click &apos;{t("addDepartment")}&apos;
            to create one.
          </div>
        ) : (
          departments.map((d) => (
            <div key={d.id} className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-btn bg-primary/10 text-primary">
                    <Building2 className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">
                      {d.name}
                    </h3>
                    {d.parentName && (
                      <span className="text-xs text-muted-foreground">
                        Sub-department of {d.parentName}
                      </span>
                    )}
                  </div>
                </div>

                {d.leadName && (
                  <span className="text-xs text-muted-foreground">
                    Lead: {d.leadName}
                  </span>
                )}
              </div>
              <DepartmentCoverageForm
                department={d}
                onSaved={(value) =>
                  setDepartments((current) =>
                    current.map((item) =>
                      item.id === d.id
                        ? { ...item, minPresencePercent: value }
                        : item,
                    ),
                  )
                }
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
