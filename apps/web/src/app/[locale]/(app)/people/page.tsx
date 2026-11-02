"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Users, Search, UserPlus, ChevronRight } from "lucide-react";
import {
  Button,
  Input,
  DataTable,
  StatusPill,
  EmptyState,
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@librehr/ui";
import { apiClient } from "../../../../lib/api-client.js";
import type { EmployeeListItem, Department } from "@librehr/contracts";

export default function PeoplePage() {
  const params = useParams();
  const locale = (params?.["locale"] as string) ?? "es";
  const t = useTranslations("people");
  const tCommon = useTranslations("common");
  const tInvites = useTranslations("invitations");

  const [employees, setEmployees] = React.useState<EmployeeListItem[]>([]);
  const [departments, setDepartments] = React.useState<Department[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [search, setSearch] = React.useState("");
  const [selectedDept, setSelectedDept] = React.useState<string>("");
  const [selectedStatus, setSelectedStatus] = React.useState<string>("");

  // Invite modal state
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [inviteEmail, setInviteEmail] = React.useState("");
  const [inviteRole, setInviteRole] = React.useState<
    "employee" | "manager" | "admin"
  >("employee");
  const [inviteSending, setInviteSending] = React.useState(false);
  const [inviteSuccess, setInviteSuccess] = React.useState(false);
  const [inviteError, setInviteError] = React.useState("");

  const fetchEmployees = React.useCallback(async () => {
    try {
      setLoading(true);
      const res = await apiClient.listEmployees({
        search: search || undefined,
        departmentId: selectedDept || undefined,
        status:
          (selectedStatus as "active" | "on_leave" | "terminated") || undefined,
      });
      setEmployees(res.items);
    } catch {
      // In dev or offline mode, maintain state
    } finally {
      setLoading(false);
    }
  }, [search, selectedDept, selectedStatus]);

  React.useEffect(() => {
    fetchEmployees();
  }, [fetchEmployees]);

  React.useEffect(() => {
    apiClient
      .listDepartments()
      .then((depts) => setDepartments(depts))
      .catch(() => {});
  }, []);

  const handleSendInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviteSending(true);
    setInviteError("");
    try {
      await apiClient.createInvitation({
        email: inviteEmail,
        role: inviteRole,
      });
      setInviteSuccess(true);
      setTimeout(() => {
        setInviteOpen(false);
        setInviteSuccess(false);
        setInviteEmail("");
      }, 1500);
    } catch (err: unknown) {
      const errorObj = err as { detail?: string };
      setInviteError(errorObj.detail ?? "Failed to send invitation");
    } finally {
      setInviteSending(false);
    }
  };

  const columns = [
    {
      id: "name",
      header: t("colName"),
      cell: (item: EmployeeListItem) => (
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
            {item.firstName.charAt(0)}
            {item.lastName.charAt(0)}
          </div>
          <div>
            <div className="font-medium text-foreground">
              {item.preferredName
                ? `${item.preferredName} (${item.firstName})`
                : `${item.firstName} ${item.lastName}`}
            </div>
            <div className="text-xs text-muted-foreground">{item.email}</div>
          </div>
        </div>
      ),
    },
    {
      id: "jobTitle",
      header: t("colJobTitle"),
      cell: (item: EmployeeListItem) => (
        <span className="text-muted-foreground">{item.jobTitle ?? "—"}</span>
      ),
    },
    {
      id: "department",
      header: t("colDepartment"),
      cell: (item: EmployeeListItem) => (
        <span className="text-muted-foreground">
          {item.departmentName ?? "—"}
        </span>
      ),
    },
    {
      id: "location",
      header: t("colLocation"),
      cell: (item: EmployeeListItem) => (
        <span className="text-muted-foreground">
          {item.locationName ?? "—"}
        </span>
      ),
    },
    {
      id: "manager",
      header: t("colManager"),
      cell: (item: EmployeeListItem) => (
        <span className="text-muted-foreground">{item.managerName ?? "—"}</span>
      ),
    },
    {
      id: "status",
      header: t("colStatus"),
      cell: (item: EmployeeListItem) => {
        const statusType =
          item.status === "active"
            ? "active"
            : item.status === "on_leave"
              ? "pending"
              : "rejected";
        const label =
          item.status === "active"
            ? t("statusActive")
            : item.status === "on_leave"
              ? t("statusOnLeave")
              : t("statusTerminated");
        return <StatusPill status={statusType} label={label} />;
      },
    },
    {
      id: "actions",
      header: "",
      cell: (item: EmployeeListItem) => (
        <div className="text-right">
          <Link
            href={`/${locale}/people/${item.id}`}
            className="inline-flex items-center gap-1 rounded-btn px-2.5 py-1 text-xs font-medium text-primary hover:bg-surface-raised transition-colors"
          >
            <span>View</span>
            <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {t("title")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>

        <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <UserPlus className="h-4 w-4" />
              <span>{t("inviteEmployee")}</span>
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{tInvites("dialogTitle")}</DialogTitle>
              <DialogDescription>
                {tInvites("dialogDescription")}
              </DialogDescription>
            </DialogHeader>

            {inviteSuccess ? (
              <div className="rounded-card bg-emerald-500/10 p-4 text-center text-sm font-medium text-emerald-600 dark:text-emerald-400">
                {tInvites("inviteSent")}
              </div>
            ) : (
              <form onSubmit={handleSendInvite} className="space-y-4">
                {inviteError && (
                  <div className="rounded-card bg-destructive/10 p-3 text-sm text-destructive">
                    {inviteError}
                  </div>
                )}
                <div className="space-y-1.5">
                  <label
                    htmlFor="invite-email"
                    className="text-xs font-medium text-foreground"
                  >
                    {tInvites("emailLabel")}
                  </label>
                  <Input
                    id="invite-email"
                    type="email"
                    required
                    placeholder="colleague@company.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                  />
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="invite-role"
                    className="text-xs font-medium text-foreground"
                  >
                    {tInvites("roleLabel")}
                  </label>
                  <select
                    id="invite-role"
                    className="flex h-10 w-full rounded-input border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                    value={inviteRole}
                    onChange={(e) =>
                      setInviteRole(
                        e.target.value as "employee" | "manager" | "admin",
                      )
                    }
                  >
                    <option value="employee">{tInvites("roleEmployee")}</option>
                    <option value="manager">{tInvites("roleManager")}</option>
                    <option value="admin">{tInvites("roleAdmin")}</option>
                  </select>
                </div>

                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setInviteOpen(false)}
                  >
                    {tCommon("cancel")}
                  </Button>
                  <Button type="submit" disabled={inviteSending}>
                    {inviteSending
                      ? tCommon("loading")
                      : tInvites("sendInvite")}
                  </Button>
                </DialogFooter>
              </form>
            )}
          </DialogContent>
        </Dialog>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t("searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="flex items-center gap-2">
          <select
            className="h-10 rounded-input border border-border bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            value={selectedDept}
            onChange={(e) => setSelectedDept(e.target.value)}
            aria-label={t("allDepartments")}
          >
            <option value="">{t("allDepartments")}</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>

          <select
            className="h-10 rounded-input border border-border bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            aria-label={t("allStatuses")}
          >
            <option value="">{t("allStatuses")}</option>
            <option value="active">{t("statusActive")}</option>
            <option value="on_leave">{t("statusOnLeave")}</option>
            <option value="terminated">{t("statusTerminated")}</option>
          </select>
        </div>
      </div>

      {/* Directory Table */}
      {loading ? (
        <div className="flex h-48 items-center justify-center rounded-card border border-border bg-surface">
          <span className="text-sm text-muted-foreground">
            {tCommon("loading")}
          </span>
        </div>
      ) : employees.length === 0 ? (
        <EmptyState
          icon={<Users className="h-6 w-6" />}
          title={t("noEmployeesFound")}
          description={t("noEmployeesDescription")}
        />
      ) : (
        <DataTable
          columns={columns}
          data={employees}
          keyExtractor={(item) => item.id}
        />
      )}
    </div>
  );
}
