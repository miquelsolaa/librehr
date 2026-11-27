import { z } from "zod";
import type { Clock } from "@librehr/core";
import {
  withTenant,
  SchedulerRepository,
  TimeExportRepository,
  type Sql,
} from "@librehr/db";
import { parsePayload } from "../lib/payload.js";
import { notifyTimeExportFailed } from "./time.export.js";

export const TimeExportCleanupPayloadSchema = z.strictObject({});

export type TimeExportCleanupPayload = z.input<
  typeof TimeExportCleanupPayloadSchema
>;

export const timeExportCleanupSingletonKey = (): string =>
  "time.export.cleanup";

/** Files removed per organization and run; the next hour takes the rest. */
export const TIME_EXPORT_CLEANUP_BATCH = 500;

/**
 * A run still `running` after this long belongs to a crashed worker. pg-boss
 * re-drives a run after TIME_EXPORT_EXPIRE_SECONDS (1 hour), three runs at
 * most, so this stays above expiry x attempts (4 h > 3 h) and never fails an
 * export that pg-boss may still be re-driving.
 */
export const TIME_EXPORT_STALE_MINUTES = 240;

export interface TimeExportCleanupDeps {
  sql: Sql;
  clock: Clock;
  logger: { info(obj: object): void; error(obj: object): void };
}

export interface TimeExportCleanupReport {
  organizations: number;
  /** Files deleted and their exports marked expired. */
  expired: number;
  /** Exports stuck in `running`, now failed (EXPORT_STALLED) and notified. */
  stalled: number;
  /** Organizations skipped because of an error (logged by id). */
  failed: number;
}

/**
 * TIM-006 (issue #38) retention of export files: every hour, for every
 * organization, deletes the files whose download period ended and marks
 * their exports `expired`, in one transaction per organization. Only the
 * bytes go: the row (id, period, hash, requester) and the ADM-002 audit
 * entry stay as the >= 4-year record of what was issued (TIM-007).
 *
 * It also fails exports left `running` by a dead worker (EXPORT_STALLED) and
 * notifies their requesters, as a failed run does.
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
          for (const id of await repo.listExpired(
            tx,
            now,
            TIME_EXPORT_CLEANUP_BATCH,
          )) {
            if (await repo.markExpired(tx, id)) report.expired++;
          }
          const stalled = await repo.failStale(
            tx,
            staleBefore,
            "EXPORT_STALLED",
          );
          for (const row of stalled) await notifyTimeExportFailed(tx, row);
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
