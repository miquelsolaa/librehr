"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  ArrowLeft,
  User,
  Briefcase,
  ShieldAlert,
  UserMinus,
} from "lucide-react";
import {
  Button,
  Input,
  StatusPill,
  SecretField,
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@librehr/ui";
import { apiClient } from "../../../../../lib/api-client.js";
import type { EmployeeProfile, TerminationReason } from "@librehr/contracts";

export default function EmployeeDetailPage() {
  const params = useParams();
  const locale = (params?.["locale"] as string) ?? "es";
  const id = (params?.["id"] as string) ?? "";

  const t = useTranslations("people");
  const tProfile = useTranslations("people.profile");
  const tCommon = useTranslations("common");

  const [employee, setEmployee] = React.useState<EmployeeProfile | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [revealedDni, setRevealedDni] = React.useState<string | null>(null);
  const [revealedIban, setRevealedIban] = React.useState<string | null>(null);

  // Termination modal state
  const [termOpen, setTermOpen] = React.useState(false);
  const [termDate, setTermDate] = React.useState(
    new Date().toISOString().slice(0, 10),
  );
  const [termReason, setTermReason] = React.useState<TerminationReason>(
    "voluntary_resignation",
  );
  const [termSubmitting, setTermSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (!id) return;
    setLoading(true);
    apiClient
      .getEmployee(id)
      .then((emp) => setEmployee(emp))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  const handleRevealDni = async () => {
    if (!employee || revealedDni) return;
    try {
      const res = await apiClient.revealEmployeeField(
        employee.id,
        "nationalId",
      );
      setRevealedDni(res.value);
    } catch {
      // reveal failure handled
    }
  };

  const handleRevealIban = async () => {
    if (!employee || revealedIban) return;
    try {
      const res = await apiClient.revealEmployeeField(employee.id, "iban");
      setRevealedIban(res.value);
    } catch {
      // reveal failure handled
    }
  };

  const handleTerminate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!employee) return;
    setTermSubmitting(true);
    try {
      const updated = await apiClient.terminateEmployee(employee.id, {
        terminationDate: termDate,
        terminationReason: termReason,
      });
      setEmployee(updated);
      setTermOpen(false);
    } catch {
      // termination error handled
    } finally {
      setTermSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <span className="text-sm text-muted-foreground">
          {tCommon("loading")}
        </span>
      </div>
    );
  }

  if (!employee) {
    return (
      <div className="space-y-4">
        <Link
          href={`/${locale}/people`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>{t("title")}</span>
        </Link>
        <p className="text-sm text-muted-foreground">
          Employee record not found.
        </p>
      </div>
    );
  }

  const isTerminated = employee.status === "terminated";

  return (
    <div className="space-y-6">
      {/* Back button & Actions header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <Link
            href={`/${locale}/people`}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>{t("title")}</span>
          </Link>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              {employee.preferredName
                ? `${employee.preferredName} (${employee.firstName}) ${employee.lastName}`
                : `${employee.firstName} ${employee.lastName}`}
            </h1>
            <StatusPill
              status={
                employee.status === "active"
                  ? "active"
                  : employee.status === "on_leave"
                    ? "pending"
                    : "rejected"
              }
              label={
                employee.status === "active"
                  ? t("statusActive")
                  : employee.status === "on_leave"
                    ? t("statusOnLeave")
                    : t("statusTerminated")
              }
            />
          </div>
          <p className="text-sm text-muted-foreground">
            {employee.jobTitle ?? "No job title specified"}
          </p>
        </div>

        {!isTerminated && (
          <Dialog open={termOpen} onOpenChange={setTermOpen}>
            <DialogTrigger asChild>
              <Button
                variant="outline"
                className="gap-2 border-destructive/40 text-destructive hover:bg-destructive/10"
              >
                <UserMinus className="h-4 w-4" />
                <span>{tProfile("terminateButton")}</span>
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{tProfile("terminateTitle")}</DialogTitle>
                <DialogDescription>
                  {tProfile("terminateDescription")}
                </DialogDescription>
              </DialogHeader>

              <form onSubmit={handleTerminate} className="space-y-4">
                <div className="space-y-1.5">
                  <label
                    htmlFor="term-date"
                    className="text-xs font-medium text-foreground"
                  >
                    {tProfile("terminationDate")}
                  </label>
                  <Input
                    id="term-date"
                    type="date"
                    required
                    value={termDate}
                    onChange={(e) => setTermDate(e.target.value)}
                  />
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="term-reason"
                    className="text-xs font-medium text-foreground"
                  >
                    {tProfile("terminationReason")}
                  </label>
                  <select
                    id="term-reason"
                    className="flex h-10 w-full rounded-input border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                    value={termReason}
                    onChange={(e) =>
                      setTermReason(e.target.value as TerminationReason)
                    }
                  >
                    <option value="voluntary_resignation">
                      {tProfile("voluntaryResignation")}
                    </option>
                    <option value="dismissal_disciplinary">
                      {tProfile("dismissalDisciplinary")}
                    </option>
                    <option value="dismissal_objective">
                      {tProfile("dismissalObjective")}
                    </option>
                    <option value="contract_expiry">
                      {tProfile("contractExpiry")}
                    </option>
                    <option value="retirement">{tProfile("retirement")}</option>
                    <option value="other">{tProfile("other")}</option>
                  </select>
                </div>

                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setTermOpen(false)}
                  >
                    {tCommon("cancel")}
                  </Button>
                  <Button
                    type="submit"
                    variant="danger"
                    disabled={termSubmitting}
                  >
                    {termSubmitting
                      ? tCommon("loading")
                      : tProfile("confirmTermination")}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* Grid: Personal Info & Employment Info */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Personal Data Card */}
        <div className="rounded-card border border-border bg-surface p-6 space-y-4">
          <div className="flex items-center gap-2 border-b border-border pb-3">
            <User className="h-5 w-5 text-primary" />
            <h2 className="text-base font-semibold text-foreground">
              {tProfile("personalInfo")}
            </h2>
          </div>

          <div className="grid gap-3 text-sm">
            <div>
              <span className="text-xs text-muted-foreground block">
                {tProfile("fullName")}
              </span>
              <span className="font-medium text-foreground">
                {employee.firstName} {employee.lastName}
              </span>
            </div>

            {employee.preferredName && (
              <div>
                <span className="text-xs text-muted-foreground block">
                  {tProfile("preferredName")}
                </span>
                <span className="text-foreground">
                  {employee.preferredName}
                </span>
              </div>
            )}

            <div>
              <span className="text-xs text-muted-foreground block">
                {tProfile("email")}
              </span>
              <span className="text-foreground">{employee.email}</span>
            </div>

            <div>
              <span className="text-xs text-muted-foreground block">
                {tProfile("phone")}
              </span>
              <span className="text-foreground">{employee.phone ?? "—"}</span>
            </div>

            <div>
              <span className="text-xs text-muted-foreground block">
                {tProfile("address")}
              </span>
              <span className="text-foreground">{employee.address ?? "—"}</span>
            </div>

            <div>
              <span className="text-xs text-muted-foreground block">
                {tProfile("birthDate")}
              </span>
              <span className="text-foreground">
                {employee.birthDate ?? "—"}
              </span>
            </div>
          </div>
        </div>

        {/* Employment & Contracts Card */}
        <div className="rounded-card border border-border bg-surface p-6 space-y-4">
          <div className="flex items-center gap-2 border-b border-border pb-3">
            <Briefcase className="h-5 w-5 text-primary" />
            <h2 className="text-base font-semibold text-foreground">
              {tProfile("employmentInfo")}
            </h2>
          </div>

          <div className="grid gap-3 text-sm">
            <div>
              <span className="text-xs text-muted-foreground block">
                {tProfile("department")}
              </span>
              <span className="font-medium text-foreground">
                {employee.departmentName ?? "—"}
              </span>
            </div>

            <div>
              <span className="text-xs text-muted-foreground block">
                {tProfile("location")}
              </span>
              <span className="text-foreground">
                {employee.locationName ?? "—"}
              </span>
            </div>

            <div>
              <span className="text-xs text-muted-foreground block">
                {tProfile("manager")}
              </span>
              <span className="text-foreground">
                {employee.managerName ?? "—"}
              </span>
            </div>

            <div>
              <span className="text-xs text-muted-foreground block">
                {tProfile("contractType")}
              </span>
              <span className="text-foreground uppercase text-xs font-mono font-medium">
                {employee.employmentType ?? "Indefinido (100)"}
              </span>
            </div>

            <div>
              <span className="text-xs text-muted-foreground block">
                {tProfile("startDate")}
              </span>
              <span className="text-foreground">
                {employee.startDate ?? "—"}
              </span>
            </div>

            {isTerminated && (
              <div className="rounded-card bg-destructive/10 p-3 border border-destructive/20 text-xs">
                <span className="font-semibold text-destructive block">
                  {tProfile("terminateTitle")}: {employee.terminationDate}
                </span>
                <span className="text-muted-foreground">
                  Reason: {employee.terminationReason}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Sensitive Statutory Fields (EMP-004) */}
      <div className="rounded-card border border-border bg-surface p-6 space-y-4">
        <div className="flex items-center justify-between border-b border-border pb-3">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-amber-500" />
            <h2 className="text-base font-semibold text-foreground">
              Sensitive Statutory Fields
            </h2>
          </div>
          <span className="text-xs text-muted-foreground">
            {tProfile("sensitiveNotice")}
          </span>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <SecretField
              label={tProfile("nationalId")}
              value={
                revealedDni ??
                (employee.hasNationalId ? "••••••••X" : "Not recorded")
              }
              onReveal={handleRevealDni}
            />
          </div>

          <div>
            <SecretField
              label={tProfile("iban")}
              value={
                revealedIban ??
                (employee.hasIban
                  ? "ES•• •••• •••• •••• •••• ••••"
                  : "Not recorded")
              }
              onReveal={handleRevealIban}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
