import { z } from "zod";
import { dateInZone, type Clock } from "@librehr/core";
import {
  withTenant,
  AuditRepository,
  NotificationRepository,
  OrganizationRepository,
  TimeExportRepository,
  type Sql,
  type TimeExportJobRow,
} from "@librehr/db";
import {
  timeExportFailedNotification,
  timeExportReadyNotification,
} from "@librehr/emails";
import {
  buildOfficialExport,
  createZoneResolver,
  mayExportOrganization,
  officialExportAuditMetadata,
  organizationExportSubjects,
} from "@librehr/time-export";
import type { ExportFileStore } from "../lib/export-files.js";
import { parsePayload } from "../lib/payload.js";

/** Ids only: everything else is read from the row (no PII in pg-boss). */
export const TimeExportPayloadSchema = z.strictObject({
  organizationId: z.guid(),
  exportId: z.guid(),
});

export type TimeExportPayload = z.input<typeof TimeExportPayloadSchema>;

export const timeExportSingletonKey = (
  p: z.output<typeof TimeExportPayloadSchema>,
) => `${p.organizationId}:${p.exportId}`;

/**
 * Runs of one export before it is marked failed. pg-boss retries a failed
 * job twice by default (three runs), and every run counts one attempt on the
 * row when it claims it.
 */
export const TIME_EXPORT_MAX_ATTEMPTS = 3;

export const TIME_EXPORT_READY_CATEGORY = "time_export_ready";
export const TIME_EXPORT_FAILED_CATEGORY = "time_export_failed";

export interface TimeExportDeps {
  sql: Sql;
  files: ExportFileStore;
  timeChainKey: string;
  clock: Clock;
  fileTtlHours: number;
  maxFileBytes: number;
  logger: { info(obj: object): void; error(obj: object): void };
}

export type TimeExportOutcome =
  /** Already ready, failed or expired (a redelivered job), or lost a race. */
  "skipped" | "ready" | "failed";

export interface TimeExportReport {
  exportId: string;
  outcome: TimeExportOutcome;
  errorCode?: string;
}

const repo = new TimeExportRepository();
const notificationRepo = new NotificationRepository();

/** `<org>/<export>-<attempt>`: a re-driven run never overwrites another's file. */
export function timeExportStorageKey(row: TimeExportJobRow): string {
  return `time-exports/${row.organizationId}/${row.id}-${row.attempts}.${row.format}`;
}

/**
 * TIM-006 (issue #38): builds a queued organization export with the same
 * builder as GET /v1/time/export, stores the file for `fileTtlHours` and
 * notifies the requester in the export's locale.
 *
 * The requester's access is checked again here: a user whose role changed
 * or whose auditor window (TIM-008) closed since the request gets a failed
 * export (FORBIDDEN), not a file. The file, the `ready` status, the ADM-002
 * `time.export` audit entry (same metadata as the synchronous route plus
 * `delivery: "async"`, actor = requester) and the notification are written
 * in one transaction; a failed export is not audited, as a refused
 * synchronous one is not.
 *
 * At-least-once safe: a job for an export that is no longer queued or
 * running does nothing, and only one run can turn a running export ready.
 * Logs carry ids and codes only.
 */
export async function handleTimeExport(
  job: { id: string; data: unknown },
  deps: TimeExportDeps,
): Promise<TimeExportReport> {
  const data = parsePayload("time.export", TimeExportPayloadSchema, job.data);
  const tenant = { organizationId: data.organizationId };
  const claimed = await withTenant(deps.sql, tenant, (tx) =>
    repo.claim(tx, data.exportId),
  );
  if (!claimed) return finish(job, deps, data.exportId, "skipped");
  if (claimed.attempts > TIME_EXPORT_MAX_ATTEMPTS) {
    return fail(job, deps, claimed, "EXPORT_FAILED");
  }

  let storedKey: string | null = null;
  try {
    const result = await withTenant(
      deps.sql,
      { ...tenant, userId: claimed.requestedBy },
      async (tx) => {
        const requester = await repo.findActiveRequester(
          tx,
          claimed.requestedBy,
        );
        if (!requester || !mayExportOrganization(requester.role)) {
          return { code: "FORBIDDEN" } as const;
        }
        const org = await new OrganizationRepository().findById(
          tx,
          data.organizationId,
        );
        if (!org) throw new Error("organization not found");
        const zones = createZoneResolver(tx);
        const period = {
          startDate: claimed.periodStart,
          endDate: claimed.periodEnd,
        };
        const { subjects } = await organizationExportSubjects(tx, period);
        const request = {
          exportId: claimed.id,
          generatedAt: deps.clock.now().toISOString(),
          generatedBy: { name: requester.name, role: requester.role },
          organizationName: org.name,
          scope: "organization" as const,
          format: claimed.format,
          locale: claimed.locale,
          period,
          subjects,
          timeChainKey: deps.timeChainKey,
          zones,
        };
        const build = await buildOfficialExport(tx, request);
        // Only the employee scope can lack a schedule.
        if (!build.ok) throw new Error("unexpected export refusal");
        // CSV without the BOM, which the download adds (it is not hashed).
        const bytes = build.pdf ?? new TextEncoder().encode(build.result.csv);
        if (bytes.byteLength > deps.maxFileBytes) {
          return { code: "EXPORT_TOO_LARGE" } as const;
        }

        const storageKey = timeExportStorageKey(claimed);
        await deps.files.put(storageKey, bytes);
        storedKey = storageKey;
        const expiresAt = new Date(
          deps.clock.now().getTime() + deps.fileTtlHours * 3_600_000,
        );
        const ready = await repo.markReady(tx, claimed.id, {
          contentHash: build.result.contentHash,
          employeeCount: build.employees.length,
          byteSize: bytes.byteLength,
          storageKey,
          expiresAt,
        });
        // Another run finished first: keep its file and record.
        if (!ready) return { code: null, superseded: true } as const;

        await new AuditRepository().log(tx, {
          actorId: claimed.requestedBy,
          action: "time.export",
          resourceType: "time_export",
          resourceId: claimed.id,
          metadata: {
            ...officialExportAuditMetadata(request, build),
            delivery: "async",
          },
        });
        const text = timeExportReadyNotification(claimed.locale, {
          periodStart: claimed.periodStart,
          periodEnd: claimed.periodEnd,
          availableUntil: dateInZone(expiresAt, await zones(null)),
        });
        await notificationRepo.create(tx, {
          userId: claimed.requestedBy,
          title: text.title,
          body: text.body,
          category: TIME_EXPORT_READY_CATEGORY,
          link: `/time/export?job=${claimed.id}`,
        });
        return { code: null, superseded: false } as const;
      },
    );
    if (result.code !== null) {
      return fail(job, deps, claimed, result.code);
    }
    if (result.superseded) {
      await deleteQuietly(deps, storedKey);
      return finish(job, deps, claimed.id, "skipped");
    }
    return finish(job, deps, claimed.id, "ready");
  } catch (err) {
    // Nothing committed: the file must not outlive its transaction.
    await deleteQuietly(deps, storedKey);
    deps.logger.error({
      msg: "time export run failed",
      requirement: "TIM-006",
      jobId: job.id,
      exportId: claimed.id,
      attempt: claimed.attempts,
      error: err instanceof Error ? err.name : "unknown",
    });
    if (claimed.attempts >= TIME_EXPORT_MAX_ATTEMPTS) {
      return fail(job, deps, claimed, "EXPORT_FAILED");
    }
    throw err;
  }
}

async function deleteQuietly(
  deps: TimeExportDeps,
  key: string | null,
): Promise<void> {
  if (key === null) return;
  try {
    await deps.files.delete(key);
  } catch {
    // The hourly cleanup cannot see an orphan; log it for the operator.
    deps.logger.error({ msg: "time export file not removed", key });
  }
}

async function fail(
  job: { id: string },
  deps: TimeExportDeps,
  row: TimeExportJobRow,
  errorCode: string,
): Promise<TimeExportReport> {
  const failed = await withTenant(
    deps.sql,
    { organizationId: row.organizationId },
    async (tx) => {
      const marked = await repo.markFailed(tx, row.id, errorCode);
      if (!marked) return false;
      const text = timeExportFailedNotification(row.locale, {
        periodStart: row.periodStart,
        periodEnd: row.periodEnd,
      });
      await notificationRepo.create(tx, {
        userId: row.requestedBy,
        title: text.title,
        body: text.body,
        category: TIME_EXPORT_FAILED_CATEGORY,
        link: `/time/export?job=${row.id}`,
      });
      return true;
    },
  );
  if (!failed) return finish(job, deps, row.id, "skipped");
  return finish(job, deps, row.id, "failed", errorCode);
}

function finish(
  job: { id: string },
  deps: TimeExportDeps,
  exportId: string,
  outcome: TimeExportOutcome,
  errorCode?: string,
): TimeExportReport {
  const report: TimeExportReport = {
    exportId,
    outcome,
    ...(errorCode ? { errorCode } : {}),
  };
  deps.logger.info({
    msg: "time export finished",
    requirement: "TIM-006",
    jobId: job.id,
    ...report,
  });
  return report;
}
