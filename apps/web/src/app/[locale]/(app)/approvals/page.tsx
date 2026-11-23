"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Button,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
} from "@librehr/ui";
import {
  PENDING_APPROVALS_LIMIT,
  type PendingLeaveApproval,
  type PendingApprovals,
  type TimeCorrectionItem,
} from "@librehr/contracts";
import { getApiClient } from "@/lib/api-client";
import { announceApprovalsChanged } from "@/lib/approvals-events";
import { formatCalendarDate, formatDateTime } from "@/lib/format";
import {
  ApprovalDecisionDialog,
  type Decision,
} from "@/components/approval-decision-dialog";
import { ApprovalRow, ApprovalsSection } from "@/components/approvals-list";

type Item =
  | { kind: "leave"; item: PendingLeaveApproval }
  | { kind: "correction"; item: TimeCorrectionItem };

const statusOf = (error: unknown) =>
  typeof error === "object" && error !== null
    ? (error as { status?: unknown }).status
    : undefined;

/** 403 / 404 / 409: decided elsewhere or no longer ours to decide. */
const isGone = (error: unknown) => {
  const status = statusOf(error);
  return status === 403 || status === 404 || status === 409;
};

/** LEA-004: the caller's own leave, offered because nobody else can decide it. */
const isSelfApproval = (entry: Item) =>
  entry.kind === "leave" && entry.item.selfApproval;

const actionId = (id: string) => `approval-${id}`;
const CONTENT_ID = "approvals-content";

/** LEA-004 / LEA-008 / TIM-003: everything waiting for the signed-in approver. */
export default function ApprovalsPage() {
  const params = useParams();
  const locale = (params?.["locale"] as string | undefined) ?? "ca";
  const t = useTranslations("approvals");
  const tTime = useTranslations("timeTracking");
  const tOff = useTranslations("timeOff");

  const [data, setData] = React.useState<PendingApprovals | null>(null);
  const [loadFailed, setLoadFailed] = React.useState(false);
  const [pending, setPending] = React.useState<{
    entry: Item;
    decision: Decision;
  } | null>(null);
  // The dialog stays mounted between decisions so it can hand focus on.
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [status, setStatus] = React.useState("");
  const [notice, setNotice] = React.useState("");
  const [failure, setFailure] = React.useState("");
  // Element to focus when the dialog closes after a decision removed its row.
  const focusAfterClose = React.useRef<string | null>(null);

  const load = React.useCallback(async () => {
    setLoadFailed(false);
    try {
      setData(await getApiClient().listPendingApprovals());
    } catch {
      setLoadFailed(true);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const items: Item[] = data
    ? [
        ...data.leaveRequests.map((item) => ({ kind: "leave" as const, item })),
        ...data.timeCorrections.map((item) => ({
          kind: "correction" as const,
          item,
        })),
      ]
    : [];

  // Keep the nav badge in step with what this page shows.
  const total = items.length;
  React.useEffect(() => {
    if (data) announceApprovalsChanged(total);
  }, [data, total]);

  const announce = (message: string) => {
    // Cleared first so the same message twice is still announced.
    setStatus("");
    window.setTimeout(() => setStatus(message), 100);
  };

  const eventLabel = (type: string) =>
    ({
      clock_in: tTime("clockIn"),
      clock_out: tTime("clockOut"),
      break_start: tTime("startBreak"),
      break_end: tTime("endBreak"),
    })[type] ?? type;

  const leaveDates = (r: PendingLeaveApproval) => {
    const start = formatCalendarDate(r.startDate, locale);
    const dates =
      r.endDate === r.startDate
        ? start
        : t("dateRange", { start, end: formatCalendarDate(r.endDate, locale) });
    const halves = [
      r.halfDayStart ? tOff("halfDayStart") : null,
      r.halfDayEnd ? tOff("halfDayEnd") : null,
    ].filter((h): h is string => h !== null);
    if (halves.length === 0) return dates;
    const halfDays = new Intl.ListFormat(locale, {
      type: "conjunction",
    }).format(halves);
    return t("datesWithHalfDays", { dates, halfDays });
  };

  const subject = ({ kind, item }: Item) =>
    kind === "leave"
      ? t("subjectLeave", {
          name: item.employeeName ?? "",
          type: item.leaveTypeName ?? "",
          dates: leaveDates(item),
        })
      : t("subjectCorrection", {
          name: item.employeeName ?? "",
          event: eventLabel(item.proposedEventType),
          when: formatDateTime(item.proposedOccurredAt, locale),
        });

  /** Removes a decided item and picks where focus should land next. */
  const remove = (entry: Item) => {
    const index = items.findIndex((i) => i.item.id === entry.item.id);
    const next = items[index + 1] ?? items[index - 1];
    focusAfterClose.current = next ? actionId(next.item.id) : CONTENT_ID;
    setData((current) =>
      current
        ? {
            ...current,
            leaveRequests: current.leaveRequests.filter(
              (r) => r.id !== entry.item.id,
            ),
            timeCorrections: current.timeCorrections.filter(
              (r) => r.id !== entry.item.id,
            ),
          }
        : current,
    );
  };

  const decide = async (comment: string | undefined) => {
    if (!pending) return;
    const { entry, decision } = pending;
    const body = comment ? { decision, reason: comment } : { decision };
    setSubmitting(true);
    setNotice("");
    setFailure("");
    try {
      if (entry.kind === "leave") {
        await getApiClient().decideLeaveRequest(entry.item.id, body);
      } else {
        await getApiClient().decideTimeCorrection(entry.item.id, body);
      }
      remove(entry);
      setDialogOpen(false);
      announce(
        t(decision === "approve" ? "approved" : "rejected", {
          name: entry.item.employeeName ?? "",
        }),
      );
    } catch (e) {
      if (isGone(e)) {
        remove(entry);
        setDialogOpen(false);
        // 403 on your own request: someone else can now decide it.
        setNotice(
          t(
            isSelfApproval(entry) && statusOf(e) === 403
              ? "selfApprovalGone"
              : "gone",
          ),
        );
      } else {
        setFailure(t("decideFailed"));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const actions = (entry: Item) => {
    const label = subject(entry);
    // Your own request can only be approved (LEA-004); cancel it instead.
    const approveOnly = isSelfApproval(entry);
    return (
      <div className="flex shrink-0 gap-2">
        {!approveOnly && (
          <Button
            id={actionId(entry.item.id)}
            variant="outline"
            size="sm"
            onClick={() => {
              setPending({ entry, decision: "reject" });
              setDialogOpen(true);
            }}
            aria-label={t("actionFor", {
              action: t("reject"),
              subject: label,
            })}
          >
            {t("reject")}
          </Button>
        )}
        <Button
          {...(approveOnly ? { id: actionId(entry.item.id) } : {})}
          size="sm"
          onClick={() => {
            setPending({ entry, decision: "approve" });
            setDialogOpen(true);
          }}
          aria-label={t("actionFor", { action: t("approve"), subject: label })}
        >
          {t("approve")}
        </Button>
      </div>
    );
  };

  const dialogTitle = (entry: Item, decision: Decision) =>
    isSelfApproval(entry)
      ? t("selfApproveTitle")
      : entry.kind === "leave"
        ? t(decision === "approve" ? "approveTitle" : "rejectTitle")
        : t(
            decision === "approve"
              ? "approveCorrectionTitle"
              : "rejectCorrectionTitle",
          );

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />

      <p role="status" className="sr-only">
        {status}
      </p>
      {notice && (
        <p role="alert" className="text-sm text-danger">
          {notice}
        </p>
      )}

      <div id={CONTENT_ID} tabIndex={-1} className="space-y-6 outline-hidden">
        {loadFailed ? (
          <ErrorState
            title={t("loadFailed")}
            retryLabel={t("retry")}
            onRetry={() => void load()}
          />
        ) : !data ? (
          <div aria-busy="true" className="space-y-3">
            <span className="sr-only">{t("loading")}</span>
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : total === 0 ? (
          <EmptyState title={t("emptyTitle")} description={t("emptyBody")} />
        ) : (
          <>
            {data.truncated && (
              <p className="text-sm text-muted-foreground">
                {t("truncated", { limit: PENDING_APPROVALS_LIMIT })}
              </p>
            )}
            <ApprovalsSection
              title={t("leaveSection")}
              count={data.leaveRequests.length}
            >
              {data.leaveRequests.map((r) => (
                <ApprovalRow
                  key={r.id}
                  title={r.employeeName ?? ""}
                  actions={actions({ kind: "leave", item: r })}
                >
                  <p className="flex items-start gap-2">
                    <span
                      aria-hidden="true"
                      className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: r.leaveTypeColor }}
                    />
                    {t("leaveDetails", {
                      type: r.leaveTypeName ?? "",
                      dates: leaveDates(r),
                      days: r.workingDays,
                    })}
                  </p>
                  {r.notes && (
                    <p className="text-muted-foreground">{r.notes}</p>
                  )}
                  {r.selfApproval && (
                    <p className="text-muted-foreground">
                      {t("selfApprovalNote")}
                    </p>
                  )}
                </ApprovalRow>
              ))}
            </ApprovalsSection>
            <ApprovalsSection
              title={t("correctionsSection")}
              count={data.timeCorrections.length}
            >
              {data.timeCorrections.map((r) => (
                <ApprovalRow
                  key={r.id}
                  title={r.employeeName ?? ""}
                  actions={actions({ kind: "correction", item: r })}
                >
                  <p>
                    {t("correctionDetails", {
                      event: eventLabel(r.proposedEventType),
                      when: formatDateTime(r.proposedOccurredAt, locale),
                    })}
                  </p>
                  <p className="text-muted-foreground">{r.reason}</p>
                </ApprovalRow>
              ))}
            </ApprovalsSection>
          </>
        )}
      </div>

      {pending && (
        <ApprovalDecisionDialog
          open={dialogOpen}
          decision={pending.decision}
          title={dialogTitle(pending.entry, pending.decision)}
          subject={subject(pending.entry)}
          submitting={submitting}
          failure={failure}
          onOpenChange={(open) => {
            if (!open) {
              setDialogOpen(false);
              setFailure("");
            }
          }}
          onConfirm={(comment) => void decide(comment)}
          selfApproval={isSelfApproval(pending.entry)}
          onCloseAutoFocus={(event) => {
            const target = focusAfterClose.current;
            focusAfterClose.current = null;
            if (target) {
              event.preventDefault();
              document.getElementById(target)?.focus();
            }
          }}
        />
      )}
    </div>
  );
}
