"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronLeft, FolderKanban, Plus } from "lucide-react";
import {
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  PageHeader,
} from "@librehr/ui";
import type { OrgGroup, OrgGroupKind } from "@librehr/contracts";
import { apiClient } from "../../../../../lib/api-client.js";

const SELECT_CLASS =
  "flex h-10 w-full rounded-input border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring";

/**
 * ORG-007 (issue #81, ADR 0008): projects and areas that employees can belong
 * to besides their primary department. Groups are archived, never deleted, so
 * past memberships keep their history.
 */
export default function GroupsSettingsPage() {
  const params = useParams();
  const locale = (params?.["locale"] as string) ?? "es";
  const t = useTranslations("orgGroups");
  const tCommon = useTranslations("common");
  const tNav = useTranslations("nav");

  const [groups, setGroups] = React.useState<OrgGroup[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState(false);

  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<OrgGroup | null>(null);
  const [kind, setKind] = React.useState<OrgGroupKind>("project");
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [parentId, setParentId] = React.useState("");
  const [formError, setFormError] = React.useState<
    "saveError" | "nameTaken" | null
  >(null);
  const [submitting, setSubmitting] = React.useState(false);

  const [archiving, setArchiving] = React.useState<OrgGroup | null>(null);
  const [archiveError, setArchiveError] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      setLoading(true);
      setLoadError(false);
      setGroups(await apiClient.listOrgGroups({ includeArchived: "true" }));
    } catch {
      setGroups([]);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const openForm = (group: OrgGroup | null) => {
    setEditing(group);
    setKind(group?.kind ?? "project");
    setName(group?.name ?? "");
    setDescription(group?.description ?? "");
    setParentId(group?.parentId ?? "");
    setFormError(null);
    setFormOpen(true);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);
    const fields = {
      name,
      description: description.trim() || null,
      parentId: kind === "project" && parentId ? parentId : null,
    };
    try {
      if (editing) await apiClient.updateOrgGroup(editing.id, fields);
      else await apiClient.createOrgGroup({ kind, ...fields });
      setFormOpen(false);
      await load();
    } catch (cause) {
      const code = (cause as { code?: unknown } | null)?.code;
      setFormError(code === "GROUP_NAME_TAKEN" ? "nameTaken" : "saveError");
    } finally {
      setSubmitting(false);
    }
  };

  const archive = async () => {
    if (!archiving) return;
    setArchiveError(false);
    try {
      await apiClient.archiveOrgGroup(archiving.id);
      await load();
    } catch {
      setArchiveError(true);
    }
  };

  const active = groups.filter((g) => !g.archivedAt);
  const archived = groups.filter((g) => g.archivedAt);
  const areas = active.filter((g) => g.kind === "area" && g.id !== editing?.id);
  const nameOf = (id: string | null) =>
    groups.find((g) => g.id === id)?.name ?? null;

  const renderGroup = (g: OrgGroup) => (
    <li
      key={g.id}
      className="flex flex-wrap items-center justify-between gap-3 p-4"
    >
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-input bg-primary/10 text-primary">
          <FolderKanban className="h-4 w-4" aria-hidden="true" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-foreground">{g.name}</h3>
          <span className="text-xs text-muted-foreground">
            {t(g.kind === "project" ? "kindProject" : "kindArea")}
            {g.parentId && nameOf(g.parentId)
              ? ` · ${t("inArea", { area: nameOf(g.parentId)! })}`
              : ""}
          </span>
          {g.description && (
            <p className="text-xs text-muted-foreground">{g.description}</p>
          )}
        </div>
      </div>
      {g.archivedAt ? (
        <Badge variant="outline">{t("archivedBadge")}</Badge>
      ) : (
        <div className="flex gap-2">
          <Button
            variant="outline"
            aria-label={t("editLabel", { name: g.name })}
            onClick={() => openForm(g)}
          >
            {t("edit")}
          </Button>
          <Button
            variant="outline"
            aria-label={t("archiveLabel", { name: g.name })}
            onClick={() => setArchiving(g)}
          >
            {t("archive")}
          </Button>
        </div>
      )}
    </li>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={
          <Link
            href={`/${locale}/settings`}
            className="inline-flex items-center gap-1 rounded-input text-muted-foreground hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            {tNav("settings")}
          </Link>
        }
        title={t("title")}
        description={t("description")}
        actions={
          <Button className="gap-2" onClick={() => openForm(null)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span>{t("add")}</span>
          </Button>
        }
      />

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? t("editTitle") : t("add")}</DialogTitle>
            <DialogDescription>{t("formDescription")}</DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            {formError && (
              <p role="alert" className="text-sm text-danger">
                {t(formError)}
              </p>
            )}
            {!editing && (
              <label className="block space-y-1.5 text-xs font-medium text-foreground">
                {t("kind")}
                <select
                  className={SELECT_CLASS}
                  value={kind}
                  onChange={(e) => setKind(e.target.value as OrgGroupKind)}
                >
                  <option value="project">{t("kindProject")}</option>
                  <option value="area">{t("kindArea")}</option>
                </select>
              </label>
            )}
            <label className="block space-y-1.5 text-xs font-medium text-foreground">
              {t("name")}
              <Input
                required
                maxLength={200}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="block space-y-1.5 text-xs font-medium text-foreground">
              {t("descriptionLabel")}
              <Input
                maxLength={2000}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
            {kind === "project" && (
              <label className="block space-y-1.5 text-xs font-medium text-foreground">
                {t("parentArea")}
                <select
                  className={SELECT_CLASS}
                  value={parentId}
                  onChange={(e) => setParentId(e.target.value)}
                >
                  <option value="">{t("noParentArea")}</option>
                  {areas.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setFormOpen(false)}
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

      <ConfirmDialog
        open={archiving !== null}
        onOpenChange={(open) => {
          if (!open) setArchiving(null);
        }}
        title={t("archiveTitle", { name: archiving?.name ?? "" })}
        description={t("archiveDescription")}
        confirmText={t("archive")}
        cancelText={tCommon("cancel")}
        onConfirm={archive}
      />

      {archiveError && (
        <p role="alert" className="text-sm text-danger">
          {t("archiveError")}
        </p>
      )}

      <div className="rounded-card border border-border bg-surface">
        {loading ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            {tCommon("loading")}
          </p>
        ) : loadError ? (
          <div role="alert" className="space-y-3 p-8 text-center text-sm">
            <p>{t("loadError")}</p>
            <Button variant="outline" onClick={() => void load()}>
              {t("retry")}
            </Button>
          </div>
        ) : active.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            {t("empty", { action: t("add") })}
          </p>
        ) : (
          <ul aria-label={t("activeLabel")} className="divide-y divide-border">
            {active.map(renderGroup)}
          </ul>
        )}
      </div>

      {archived.length > 0 && (
        <section aria-labelledby="archived-groups" className="space-y-2">
          <h2
            id="archived-groups"
            className="text-base font-semibold text-foreground"
          >
            {t("archivedTitle")}
          </h2>
          <ul className="divide-y divide-border rounded-card border border-border bg-surface">
            {archived.map(renderGroup)}
          </ul>
        </section>
      )}
    </div>
  );
}
