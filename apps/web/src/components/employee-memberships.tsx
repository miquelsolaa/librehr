"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import type {
  Department,
  EmployeeMembership,
  EmployeeMembershipWriteResponse,
  OrgGroup,
} from "@librehr/contracts";
import { Button, Input } from "@librehr/ui";
import { apiClient } from "@/lib/api-client";
import { getStoredSession } from "@/lib/auth";
import { formatCalendarDate, localIsoDate } from "@/lib/format";
import {
  EmployeeMembershipForm,
  membershipErrorFor,
  type MembershipErrorKey,
} from "./employee-membership-form";

const TYPE_LABEL = {
  department: "typeDepartment",
  project: "typeProject",
  area: "typeArea",
} as const;

/**
 * ORG-007 (issue #81): the employee's secondary departments, projects and
 * areas. Everyone who can see the profile sees the list; admins add, change
 * and end memberships. Rows are never deleted, so past ones stay listed.
 */
export function EmployeeMemberships({
  employeeId,
  primaryDepartmentId,
}: {
  employeeId: string;
  primaryDepartmentId: string | null;
}) {
  const t = useTranslations("memberships");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const titleId = React.useId();
  const today = localIsoDate();

  const [rows, setRows] = React.useState<EmployeeMembership[] | null>(null);
  const [loadError, setLoadError] = React.useState(false);
  const [canEdit, setCanEdit] = React.useState(false);
  const [departments, setDepartments] = React.useState<Department[]>([]);
  const [groups, setGroups] = React.useState<OrgGroup[]>([]);
  const [editing, setEditing] = React.useState<EmployeeMembership | null>(null);
  const [formKey, setFormKey] = React.useState(0);
  const [warning, setWarning] =
    React.useState<EmployeeMembershipWriteResponse["overAllocation"]>(null);

  const [endingId, setEndingId] = React.useState<string | null>(null);
  const [endOn, setEndOn] = React.useState(today);
  const [endReason, setEndReason] = React.useState("");
  const [endError, setEndError] = React.useState<MembershipErrorKey | null>(
    null,
  );
  const [ending, setEnding] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoadError(false);
    try {
      setRows(await apiClient.listEmployeeMemberships(employeeId));
    } catch {
      setLoadError(true);
    }
  }, [employeeId]);

  React.useEffect(() => {
    const admin = getStoredSession()?.role === "admin";
    setCanEdit(admin);
    setRows(null);
    void load();
    if (!admin) return;
    // Only the add form needs the targets; a failure leaves them empty.
    void apiClient
      .listDepartments()
      .then(setDepartments)
      .catch(() => setDepartments([]));
    void apiClient
      .listOrgGroups()
      .then(setGroups)
      .catch(() => setGroups([]));
  }, [load]);

  const closeForm = () => {
    setEditing(null);
    setFormKey((k) => k + 1);
  };

  const saved = async (result: EmployeeMembershipWriteResponse) => {
    setWarning(result.overAllocation);
    closeForm();
    await load();
  };

  const confirmEnd = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!endingId || !event.currentTarget.reportValidity()) return;
    setEnding(true);
    setEndError(null);
    try {
      await apiClient.endEmployeeMembership(employeeId, endingId, {
        endDate: endOn,
        reason: endReason.trim() || null,
      });
      setEndingId(null);
      setEndReason("");
      await load();
    } catch (cause) {
      setEndError(membershipErrorFor(cause));
    } finally {
      setEnding(false);
    }
  };

  const date = (value: string) => formatCalendarDate(value, locale);
  const current = (rows ?? []).filter((m) => !m.endDate || m.endDate >= today);
  const past = (rows ?? []).filter((m) => m.endDate && m.endDate < today);

  const renderRow = (m: EmployeeMembership, editable: boolean) => (
    <li key={m.id} className="space-y-2 rounded-input border border-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <span className="font-medium text-foreground">{m.targetName}</span>{" "}
          <span className="text-xs text-muted-foreground">
            · {t(TYPE_LABEL[m.targetType])}
            {m.role ? ` · ${m.role}` : ""}
            {m.allocationPercent !== null
              ? ` · ${t("allocationValue", { percent: m.allocationPercent })}`
              : ""}
          </span>
          <br />
          <span className="text-sm text-muted-foreground">
            {date(m.startDate)} – {m.endDate ? date(m.endDate) : t("openEnded")}
          </span>
        </div>
        {editable && (
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              aria-label={t("editLabel", { name: m.targetName })}
              onClick={() => {
                setEditing(m);
                setWarning(null);
              }}
            >
              {t("edit")}
            </Button>
            <Button
              type="button"
              variant="outline"
              aria-label={t("endLabel", { name: m.targetName })}
              onClick={() => {
                setEndingId(m.id);
                setEndOn(today < m.startDate ? m.startDate : today);
                setEndError(null);
              }}
            >
              {t("end")}
            </Button>
          </div>
        )}
      </div>
      {endingId === m.id && (
        <form onSubmit={confirmEnd} className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm">
            {t("endDate")}
            <Input
              type="date"
              required
              min={m.startDate}
              value={endOn}
              onChange={(e) => setEndOn(e.target.value)}
            />
          </label>
          <label className="text-sm">
            {t("endReason")}
            <Input
              value={endReason}
              maxLength={500}
              onChange={(e) => setEndReason(e.target.value)}
            />
          </label>
          <div className="flex items-end gap-2">
            <Button type="submit" disabled={ending}>
              {t("confirmEnd")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setEndingId(null)}
            >
              {tCommon("cancel")}
            </Button>
          </div>
          {endError && (
            <p role="alert" className="text-sm text-danger sm:col-span-3">
              {t(endError)}
            </p>
          )}
        </form>
      )}
    </li>
  );

  return (
    <section
      className="rounded-card border border-border bg-surface p-6 space-y-4"
      aria-labelledby={titleId}
    >
      <div>
        <h2 id={titleId} className="text-base font-semibold text-foreground">
          {t("title")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </div>
      {loadError ? (
        <div role="alert" className="space-y-2 text-sm">
          <p className="text-danger">{t("loadError")}</p>
          <Button variant="outline" onClick={() => void load()}>
            {t("retry")}
          </Button>
        </div>
      ) : rows === null ? (
        <p>{tCommon("loading")}</p>
      ) : (
        <>
          {current.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("empty")}</p>
          ) : (
            <ul aria-label={t("currentLabel")} className="space-y-2">
              {current.map((m) => renderRow(m, canEdit))}
            </ul>
          )}
          {past.length > 0 && (
            <>
              <h3 className="text-sm font-semibold text-foreground">
                {t("pastTitle")}
              </h3>
              <ul aria-label={t("pastTitle")} className="space-y-2">
                {past.map((m) => renderRow(m, false))}
              </ul>
            </>
          )}
        </>
      )}
      {warning && (
        <p role="status" className="text-sm text-warning">
          {t("overAllocated", {
            date: date(warning.date),
            percent: warning.totalPercent,
          })}
        </p>
      )}
      {canEdit && rows !== null && !loadError && (
        <EmployeeMembershipForm
          key={editing ? `edit-${editing.id}` : `add-${formKey}`}
          employeeId={employeeId}
          primaryDepartmentId={primaryDepartmentId}
          editing={editing}
          departments={departments}
          groups={groups}
          onSaved={saved}
          onCancel={closeForm}
        />
      )}
    </section>
  );
}
