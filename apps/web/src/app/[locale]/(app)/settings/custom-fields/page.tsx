"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Sliders, Plus, ArrowLeft, Trash2, Tag, Eye } from "lucide-react";
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
            Custom Profile Fields
          </h1>
          <p className="text-sm text-muted-foreground">
            Define organization-specific attributes (uniforms, badges, licenses)
            for employee profiles.
          </p>
        </div>

        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              <span>Add Custom Field</span>
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Custom Profile Field</DialogTitle>
              <DialogDescription>
                Create a dynamic attribute configured across employee records.
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
                  Field Name
                </label>
                <Input
                  id="cf-name"
                  required
                  placeholder="e.g. Uniform Size or Parking Slot"
                  value={name}
                  onChange={(e) => handleNameChange(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="cf-code"
                  className="text-xs font-medium text-foreground"
                >
                  Field Code (identifier)
                </label>
                <Input
                  id="cf-code"
                  required
                  placeholder="e.g. uniform_size"
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
                    Field Type
                  </label>
                  <select
                    id="cf-type"
                    className="flex h-10 w-full rounded-input border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                    value={fieldType}
                    onChange={(e) =>
                      setFieldType(e.target.value as CustomFieldType)
                    }
                  >
                    <option value="text">Text</option>
                    <option value="number">Number</option>
                    <option value="date">Date</option>
                    <option value="select">Dropdown Select</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="cf-visibility"
                    className="text-xs font-medium text-foreground"
                  >
                    Visibility Scope
                  </label>
                  <select
                    id="cf-visibility"
                    className="flex h-10 w-full rounded-input border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                    value={visibility}
                    onChange={(e) =>
                      setVisibility(e.target.value as CustomFieldVisibility)
                    }
                  >
                    <option value="employee">Employee & Above</option>
                    <option value="manager">Manager & Above</option>
                    <option value="hr">HR & Admin Only</option>
                    <option value="admin">Admin Only</option>
                    <option value="public">Public / Company-Wide</option>
                  </select>
                </div>
              </div>

              {fieldType === "select" && (
                <div className="space-y-1.5">
                  <label
                    htmlFor="cf-options"
                    className="text-xs font-medium text-foreground"
                  >
                    Select Options (comma-separated)
                  </label>
                  <Input
                    id="cf-options"
                    required
                    placeholder="e.g. S, M, L, XL, XXL"
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
                  Mandatory field during employee profile completion
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
                  {submitting ? tCommon("loading") : "Create Field"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

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
            No custom fields defined yet.
          </div>
        ) : (
          definitions.map((def) => (
            <div key={def.id} className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-btn bg-primary/10 text-primary">
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
                        className="text-[10px] text-amber-500 border-amber-500/30"
                      >
                        Required
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2 pt-1 text-xs text-muted-foreground">
                    <span className="capitalize flex items-center gap-1">
                      <Tag className="h-3 w-3" />
                      Type: {def.fieldType}
                    </span>
                    <span>&middot;</span>
                    <span className="capitalize flex items-center gap-1">
                      <Eye className="h-3 w-3" />
                      Visibility: {def.visibility}
                    </span>
                    {def.options && def.options.length > 0 && (
                      <>
                        <span>&middot;</span>
                        <span>Options: {def.options.join(", ")}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <Button
                size="sm"
                variant="outline"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive gap-1.5"
                onClick={() => handleDelete(def.id)}
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Delete</span>
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
