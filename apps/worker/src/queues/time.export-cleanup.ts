import { z } from "zod";
import type { Clock } from "@librehr/core";
import {
  withTenant,
  SchedulerRepository,
  TimeExportRepository,
  type Sql,
} from "@librehr/db";
import type { ExportFileStore } from "../lib/export-files.js";
import { parsePayload } from "../lib/payload.js";

export const TimeExportCleanupPayloadSchema = z.strictObject({});

export type TimeExportCleanupPayload = z.input<
  typeof TimeExportCleanupPayloadSchema
>;

export const timeExportCleanupSingletonKey = (): string =>
  "time.export.cleanup";

/** Files removed per organization and run; the next hour takes the rest. */
export const TIME_EXPORT_CLEANUP_BATCH = 500;

/**
 * A run still `running` after this long belongs to a crashed worker: pg-boss
 * re-drives a job after 15 minutes, three times at most.
 */
export const TIME_EXPORT_STALE_MINUTES = 120;

export interface TimeExportCleanupDeps {
  sql: Sql;
  files: ExportFileStore;
  clock: Clock;
  logger: { info(obj: object): void; error(obj: object): void };
}

export interface TimeExportCleanupReport {
  organizations: number;
  /** Files deleted and their exports marked expired. */
  expired: number;
  /** Exports stuck in `running`, now failed (EXPORT_STALLED). */
  stalled: number;
  /** Organizations skipped because of an error (logged by id). */
  failed: number;
}

/**
 * TIM-006 (issue #38) retention of export files: every hour, for every
 * organization, deletes the files whose download period ended and marks
 * their exports `expired`. Only the bytes go: the row (id, period, hash,
 * requester) and the ADM-002 audit entry stay as the >= 4-year record of
 * what was issued (TIM-007). The file is deleted before the row changes, so
 * a failure leaves a ready-but-expired row (which the download refuses by
 * date) and never a file nobody tracks.
 */
export async function handleTimeExportCleanup(
  job: { id: string; data: unknown },
  deps: TimeExportCleanupDeps,
): Promise<TimeExportCleanupReport> {
  parsePayload("time.export.cleanup", TimeExportCleanupPayloadSchema, job.data);
  const repo = new TimeExportRepository();
  const now = deps.clock.now();
  const staleBefore = new Date(
    now.getTime() - TIME_EXPORT_STALE_MINUTES * 60_000,
  );
  const organizations = await new SchedulerRepository().listOrganizations(
    deps.sql,
  );
  const report: TimeExportCleanupReport = {
    organizations: organizations.length,
    expired: 0,
    stalled: 0,
    failed: 0,
  };
  for (const org of organizations) {
    try {
      await withTenant(
        deps.sql,
        { organizationId: org.organizationId },
        async (tx) => {
          for (const row of await repo.listExpired(
            tx,
            now,
            TIME_EXPORT_CLEANUP_BATCH,
          )) {
            await deps.files.delete(row.storageKey);
            if (await repo.markExpired(tx, row.id)) report.expired++;
          }
          const stalled = await repo.failStale(
            tx,
            staleBefore,
            "EXPORT_STALLED",
          );
          report.stalled += stalled.length;
        },
      );
    } catch (err) {
      report.failed++;
      deps.logger.error({
        msg: "time export cleanup skipped an organization",
        requirement: "TIM-006",
        jobId: job.id,
        organizationId: org.organizationId,
        error: err instanceof Error ? err.name : "unknown",
      });
    }
  }
  deps.logger.info({
    msg: "time export cleanup finished",
    requirement: "TIM-006",
    jobId: job.id,
    ...report,
  });
  return report;
}
