"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Sliders, Plus, Trash2, Tag, Eye, ChevronLeft } from "lucide-react";
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
  Badge,
  PageHeader,
} from "@librehr/ui";
import { apiClient } from "../../../../../lib/api-client.js";
import type {
  CustomFieldDefinition,
  CustomFieldType,
  CustomFieldVisibility,
} from "@librehr/contracts";

export default function CustomFieldsSettingsPage() {
  const params = useParams();
  const locale = (params?.["locale"] as string) ?? "es";
  const tCommon = useTranslations("common");
  const t = useTranslations("settings");
  const tNav = useTranslations("nav");

  const typeLabel = (type: string): string => {
    switch (type) {
      case "text":
        return t("customFieldTypeText");
      case "number":
        return t("customFieldTypeNumber");
      case "date":
        return t("customFieldTypeDate");
      case "select":
        return t("customFieldTypeSelect");
      default:
        return type;
    }
  };

  const visibilityLabel = (value: string): string => {
    switch (value) {
      case "employee":
        return t("customFieldVisibilityEmployee");
      case "manager":
        return t("customFieldVisibilityManager");
      case "hr":
        return t("customFieldVisibilityHr");
      case "admin":
        return t("customFieldVisibilityAdmin");
      case "public":
        return t("customFieldVisibilityPublic");
      default:
        return value;
    }
  };

  const [definitions, setDefinitions] = React.useState<CustomFieldDefinition[]>(
    [],
  );
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState(false);
  const [actionError, setActionError] = React.useState(false);

  // Dialog state
  const [createOpen, setCreateOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [code, setCode] = React.useState("");
  const [fieldType, setFieldType] = React.useState<CustomFieldType>("text");
  const [optionsStr, setOptionsStr] = React.useState("");
  const [required, setRequired] = React.useState(false);
  const [visibility, setVisibility] =
    React.useState<CustomFieldVisibility>("employee");
  const [submitting, setSubmitting] = React.useState(false);

  const loadDefinitions = React.useCallback(async () => {
    try {
      setLoading(true);
      setLoadError(false);
      const res = await apiClient.listCustomFields();
      setDefinitions(res);
    } catch {
      setDefinitions([]);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadDefinitions();
  }, [loadDefinitions]);

  const handleNameChange = (val: string) => {
    setName(val);
    if (!code || code === name.toLowerCase().replace(/[^a-z0-9]/g, "_")) {
      setCode(val.toLowerCase().replace(/[^a-z0-9]/g, "_"));
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setActionError(false);
    try {
      const options =
        fieldType === "select"
          ? optionsStr
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : undefined;

      await apiClient.createCustomField({
        name,
        code,
        fieldType,
        options,
        required,
        visibility,
      });

      setName("");
      setCode("");
      setFieldType("text");
      setOptionsStr("");
      setRequired(false);
      setVisibility("employee");
      setCreateOpen(false);

      loadDefinitions();
    } catch {
      setActionError(true);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    setActionError(false);
    try {
      await apiClient.deleteCustomField(id);
      loadDefinitions();
    } catch {
      setActionError(true);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={
          <Link
            href={`/${locale}/settings`}
            className="inline-flex items-center gap-1 rounded-input text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            {tNav("settings")}
          </Link>
        }
        title={t("customFieldsTitle")}
        description={t("customFieldsDescription")}
        actions={
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="h-4 w-4" />
                <span>{t("customFieldAdd")}</span>
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t("customFieldAddTitle")}</DialogTitle>
                <DialogDescription>
                  {t("customFieldAddDescription")}
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
                    htmlFor="cf-name"
                    className="text-xs font-medium text-foreground"
                  >
                    {t("customFieldName")}
                  </label>
                  <Input
                    id="cf-name"
                    required
                    placeholder={t("customFieldNamePlaceholder")}
                    value={name}
                    onChange={(e) => handleNameChange(e.target.value)}
                  />
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="cf-code"
                    className="text-xs font-medium text-foreground"
                  >
                    {t("customFieldCode")}
                  </label>
                  <Input
                    id="cf-code"
                    required
                    placeholder={t("customFieldCodePlaceholder")}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label
                      htmlFor="cf-type"
                      className="text-xs font-medium text-foreground"
                    >
                      {t("customFieldType")}
                    </label>
                    <select
                      id="cf-type"
                      className="flex h-10 w-full rounded-input border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                      value={fieldType}
                      onChange={(e) =>
                        setFieldType(e.target.value as CustomFieldType)
                      }
                    >
                      <option value="text">{typeLabel("text")}</option>
                      <option value="number">{typeLabel("number")}</option>
                      <option value="date">{typeLabel("date")}</option>
                      <option value="select">{typeLabel("select")}</option>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label
                      htmlFor="cf-visibility"
                      className="text-xs font-medium text-foreground"
                    >
                      {t("customFieldVisibility")}
                    </label>
                    <select
                      id="cf-visibility"
                      className="flex h-10 w-full rounded-input border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                      value={visibility}
                      onChange={(e) =>
                        setVisibility(e.target.value as CustomFieldVisibility)
                      }
                    >
                      <option value="employee">
                        {visibilityLabel("employee")}
                      </option>
                      <option value="manager">
                        {visibilityLabel("manager")}
                      </option>
                      <option value="hr">{visibilityLabel("hr")}</option>
                      <option value="admin">{visibilityLabel("admin")}</option>
                      <option value="public">
                        {visibilityLabel("public")}
                      </option>
                    </select>
                  </div>
                </div>

                {fieldType === "select" && (
                  <div className="space-y-1.5">
                    <label
                      htmlFor="cf-options"
                      className="text-xs font-medium text-foreground"
                    >
                      {t("customFieldOptions")}
                    </label>
                    <Input
                      id="cf-options"
                      required
                      placeholder={t("customFieldOptionsPlaceholder")}
                      value={optionsStr}
                      onChange={(e) => setOptionsStr(e.target.value)}
                    />
                  </div>
                )}

                <div className="flex items-center gap-2 pt-1">
                  <input
                    id="cf-required"
                    type="checkbox"
                    checked={required}
                    onChange={(e) => setRequired(e.target.checked)}
                    className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                  />
                  <label
                    htmlFor="cf-required"
                    className="text-xs text-foreground cursor-pointer select-none"
                  >
                    {t("customFieldRequired")}
                  </label>
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
                    {submitting ? tCommon("loading") : t("customFieldCreate")}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        }
      />

      {actionError && !createOpen && (
        <p role="alert" className="text-sm text-danger">
          {t("actionError")}
        </p>
      )}
      {/* Definitions List */}
      <div className="rounded-card border border-border bg-surface divide-y divide-border">
        {loading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            {tCommon("loading")}
          </div>
        ) : loadError ? (
          <div role="alert" className="space-y-3 p-8 text-center text-sm">
            <p>{t("loadError")}</p>
            <Button variant="outline" onClick={() => void loadDefinitions()}>
              {t("retry")}
            </Button>
          </div>
        ) : definitions.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            {t("customFieldsEmpty")}
          </div>
        ) : (
          definitions.map((def) => (
            <div key={def.id} className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-input bg-primary/10 text-primary">
                  <Sliders className="h-4 w-4" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-foreground">
                      {def.name}
                    </h3>
                    <code className="text-xs bg-surface-raised px-1.5 py-0.5 rounded text-muted-foreground font-mono">
                      {def.code}
                    </code>
                    {def.required && (
                      <Badge
                        variant="outline"
                        className="text-xs text-warning border-warning/30"
                      >
                        {t("customFieldRequiredBadge")}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2 pt-1 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Tag className="h-3 w-3" aria-hidden="true" />
                      {t("customFieldTypeValue", {
                        type: typeLabel(def.fieldType),
                      })}
                    </span>
                    <span>&middot;</span>
                    <span className="flex items-center gap-1">
                      <Eye className="h-3 w-3" aria-hidden="true" />
                      {t("customFieldVisibilityValue", {
                        visibility: visibilityLabel(def.visibility),
                      })}
                    </span>
                    {def.options && def.options.length > 0 && (
                      <>
                        <span>&middot;</span>
                        <span>
                          {t("customFieldOptionsValue", {
                            options: def.options.join(", "),
                          })}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <Button
                size="sm"
                variant="outline"
                className="text-danger hover:bg-danger/10 hover:text-danger gap-1.5"
                onClick={() => handleDelete(def.id)}
                aria-label={t("customFieldDelete", { name: def.name })}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{tCommon("delete")}</span>
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
