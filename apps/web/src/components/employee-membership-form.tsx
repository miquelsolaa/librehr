"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import type {
  Department,
  EmployeeMembership,
  EmployeeMembershipWriteResponse,
  OrgGroup,
} from "@librehr/contracts";
import { Button, Input } from "@librehr/ui";
import { apiClient } from "@/lib/api-client";

export type MembershipErrorKey =
  "saveError" | "overlapError" | "primaryError" | "allocationInvalid";

/** Maps the API's problem codes to messages the person can act on. */
export function membershipErrorFor(cause: unknown): MembershipErrorKey {
  const code = (cause as { code?: unknown } | null)?.code;
  if (code === "MEMBERSHIP_OVERLAP") return "overlapError";
  if (code === "SECONDARY_IS_PRIMARY") return "primaryError";
  return "saveError";
}

/**
 * Allocation typed by an admin (ADR 0008 D3): "" means none, a decimal comma
 * is accepted, and anything outside (0, 100] with at most two decimals is NaN.
 */
function parseAllocation(raw: string): number | null {
  const trimmed = raw.trim().replace(",", ".");
  if (trimmed === "") return null;
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(trimmed)) return Number.NaN;
  const value = Number(trimmed);
  return value > 0 &&
    value <= 100 &&
    Math.abs(Math.round(value * 100) - value * 100) < 1e-6
    ? value
    : Number.NaN;
}

const SELECT_CLASS =
  "flex h-10 w-full rounded-input border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring";

/**
 * ORG-007: adds a membership, or changes the dates, role and allocation of
 * `editing`. The target of an existing membership cannot change; ending it
 * and adding a new one keeps the history.
 */
export function EmployeeMembershipForm({
  employeeId,
  primaryDepartmentId,
  editing,
  departments,
  groups,
  onSaved,
  onCancel,
}: {
  employeeId: string;
  primaryDepartmentId: string | null;
  editing: EmployeeMembership | null;
  departments: Department[];
  groups: OrgGroup[];
  onSaved: (result: EmployeeMembershipWriteResponse) => Promise<void>;
  onCancel: () => void;
}) {
  const t = useTranslations("memberships");
  const tCommon = useTranslations("common");
  const fieldId = React.useId();
  const [target, setTarget] = React.useState("");
  const [role, setRole] = React.useState(editing?.role ?? "");
  const [allocation, setAllocation] = React.useState(
    editing?.allocationPercent == null ? "" : String(editing.allocationPercent),
  );
  const [startDate, setStartDate] = React.useState(editing?.startDate ?? "");
  const [endDate, setEndDate] = React.useState(editing?.endDate ?? "");
  const [error, setError] = React.useState<MembershipErrorKey | null>(null);
  const [saving, setSaving] = React.useState(false);
  const allocationInvalid = error === "allocationInvalid";

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    const allocationPercent = parseAllocation(allocation);
    if (Number.isNaN(allocationPercent)) {
      setError("allocationInvalid");
      return;
    }
    setSaving(true);
    setError(null);
    const fields = {
      role: role.trim() || null,
      allocationPercent,
      startDate,
      endDate: endDate || null,
    };
    try {
      if (editing) {
        await onSaved(
          await apiClient.updateEmployeeMembership(
            employeeId,
            editing.id,
            fields,
          ),
        );
      } else {
        const [kind, id = ""] = target.split(":");
        await onSaved(
          await apiClient.createEmployeeMembership(employeeId, {
            ...(kind === "department" ? { departmentId: id } : { groupId: id }),
            ...fields,
          }),
        );
      }
    } catch (cause) {
      setError(membershipErrorFor(cause));
      setSaving(false);
    }
  };

  const groupOptions = (kind: OrgGroup["kind"]) =>
    groups
      .filter((g) => g.kind === kind && !g.archivedAt)
      .map((g) => (
        <option key={g.id} value={`group:${g.id}`}>
          {g.name}
        </option>
      ));

  return (
    <form
      onSubmit={submit}
      noValidate
      className="space-y-3 border-t border-border pt-4"
    >
      <h3 className="text-sm font-semibold text-foreground">
        {editing ? t("editTitle", { name: editing.targetName }) : t("addTitle")}
      </h3>
      <div className="grid gap-3 sm:grid-cols-2">
        {!editing && (
          <label className="text-sm">
            {t("target")}
            <select
              required
              className={SELECT_CLASS}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            >
              <option value="">{t("targetPlaceholder")}</option>
              <optgroup label={t("typeDepartments")}>
                {departments
                  .filter((d) => d.id !== primaryDepartmentId)
                  .map((d) => (
                    <option key={d.id} value={`department:${d.id}`}>
                      {d.name}
                    </option>
                  ))}
              </optgroup>
              <optgroup label={t("typeProjects")}>
                {groupOptions("project")}
              </optgroup>
              <optgroup label={t("typeAreas")}>{groupOptions("area")}</optgroup>
            </select>
          </label>
        )}
        <label className="text-sm">
          {t("role")}
          <Input
            value={role}
            maxLength={100}
            onChange={(e) => setRole(e.target.value)}
          />
        </label>
        <div className="text-sm">
          <label htmlFor={`${fieldId}-allocation`}>{t("allocation")}</label>
          <Input
            id={`${fieldId}-allocation`}
            inputMode="decimal"
            autoComplete="off"
            value={allocation}
            onChange={(e) => {
              setAllocation(e.target.value);
              if (allocationInvalid) setError(null);
            }}
            aria-invalid={allocationInvalid || undefined}
            aria-describedby={`${fieldId}-allocation-hint`}
          />
          <p
            id={`${fieldId}-allocation-hint`}
            className="text-xs text-muted-foreground"
          >
            {t("allocationHint")}
          </p>
        </div>
        <label className="text-sm">
          {t("startDate")}
          <Input
            type="date"
            required
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </label>
        <label className="text-sm">
          {t("endDateOptional")}
          <Input
            type="date"
            min={startDate || undefined}
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </label>
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {t(error)}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={saving}>
          {editing ? tCommon("save") : t("add")}
        </Button>
        {editing && (
          <Button type="button" variant="outline" onClick={onCancel}>
            {tCommon("cancel")}
          </Button>
        )}
      </div>
    </form>
  );
}
