"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Search, UserPlus, ChevronRight } from "lucide-react";
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
  PageHeader,
} from "@librehr/ui";
import { getApiClient } from "@/lib/api-client";
import { getStoredSession } from "@/lib/auth";
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
  const [loadError, setLoadError] = React.useState<
    "signInRequired" | "loadError" | null
  >(null);
  const [departmentsError, setDepartmentsError] = React.useState(false);
  const requestSequence = React.useRef(0);
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
    const sequence = ++requestSequence.current;
    setLoading(true);
    setLoadError(null);
    const session = getStoredSession();
    if (!session) {
      setEmployees([]);
      setLoadError("signInRequired");
      setLoading(false);
      return;
    }
    try {
      const res = await getApiClient().listEmployees({
        search: search || undefined,
        departmentId: selectedDept || undefined,
        status:
          (selectedStatus as "active" | "on_leave" | "terminated") || undefined,
      });
      if (sequence === requestSequence.current) setEmployees(res.items);
    } catch {
      if (sequence === requestSequence.current) {
        setEmployees([]);
        setLoadError("loadError");
      }
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [search, selectedDept, selectedStatus]);

  React.useEffect(() => {
    fetchEmployees();
  }, [fetchEmployees]);

  const fetchDepartments = React.useCallback(() => {
    const session = getStoredSession();
    if (!session) return;
    setDepartmentsError(false);
    void getApiClient()
      .listDepartments()
      .then((depts) => setDepartments(depts))
      .catch(() => {
        setDepartments([]);
        setDepartmentsError(true);
      });
  }, []);
  React.useEffect(() => {
    fetchDepartments();
  }, [fetchDepartments]);

  const handleSendInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviteSending(true);
    setInviteError("");
    try {
      const session = getStoredSession();
      if (!session) throw new Error("Session unavailable");
      await getApiClient().createInvitation({
        email: inviteEmail,
        role: inviteRole,
      });
      setInviteSuccess(true);
      setTimeout(() => {
        setInviteOpen(false);
        setInviteSuccess(false);
        setInviteEmail("");
      }, 1500);
    } catch {
      setInviteError(t("inviteError"));
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
              ? "away"
              : "inactive";
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
            className="inline-flex items-center gap-1 rounded-input px-2.5 py-1 text-xs font-medium text-primary hover:bg-surface-raised transition-colors"
          >
            <span>{t("view")}</span>
            <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <>
            <div className="flex items-center rounded-input border border-border bg-surface p-1">
              <span className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-sm">
                {t("directory")}
              </span>
              <Link
                href={`/${locale}/people/org-chart`}
                className="rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                {t("orgChart")}
              </Link>
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
                  <div className="rounded-card bg-success/10 p-4 text-center text-sm font-medium text-success">
                    {tInvites("inviteSent")}
                  </div>
                ) : (
                  <form onSubmit={handleSendInvite} className="space-y-4">
                    {inviteError && (
                      <div className="rounded-card bg-danger/10 p-3 text-sm text-danger">
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
                        placeholder={tInvites("emailPlaceholder")}
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
                        <option value="employee">
                          {tInvites("roleEmployee")}
                        </option>
                        <option value="manager">
                          {tInvites("roleManager")}
                        </option>
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
          </>
        }
      />

      {/* Filter and Search Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t("searchPlaceholder")}
            aria-label={t("searchPlaceholder")}
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

      {departmentsError && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground"
        >
          <span>{t("departmentsError")}</span>
          <button
            type="button"
            className="text-primary underline"
            onClick={fetchDepartments}
          >
            {t("retry")}
          </button>
        </div>
      )}

      {/* Directory Table */}
      {loading ? (
        <div className="flex h-48 items-center justify-center rounded-card border border-border bg-surface">
          <span className="text-sm text-muted-foreground">
            {tCommon("loading")}
          </span>
        </div>
      ) : loadError ? (
        <div
          role="alert"
          className="space-y-3 rounded-card border border-border bg-surface p-6 text-sm"
        >
          <p>{t(loadError)}</p>
          {loadError === "signInRequired" ? (
            <Link
              className="text-primary underline"
              href={`/${locale}/sign-in`}
            >
              {t("signIn")}
            </Link>
          ) : (
            <Button variant="outline" onClick={() => void fetchEmployees()}>
              {t("retry")}
            </Button>
          )}
        </div>
      ) : employees.length === 0 ? (
        <EmptyState
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
