import { z } from "zod";
import { TimeExportRepository, type Sql } from "@librehr/db";
import type { ScheduleAdmin } from "../lib/scheduler.js";
import { parsePayload } from "../lib/payload.js";
import type { TimeExportPayload } from "./time.export.js";

export const TIME_EXPORT_DISPATCH_QUEUE = "time.export.dispatch";
export const TIME_EXPORT_CLEANUP_QUEUE = "time.export.cleanup";

/** Queued exports moved to pg-boss per sweep; the next minute takes the rest. */
export const TIME_EXPORT_DISPATCH_BATCH = 50;

/** The sweep carries no data: it reads the outbox (`time_exports`). */
export const TimeExportDispatchPayloadSchema = z.strictObject({});

export type TimeExportDispatchPayload = z.input<
  typeof TimeExportDispatchPayloadSchema
>;

/** Constant key: at most one sweep is queued or running at a time. */
export const timeExportDispatchSingletonKey = (): string =>
  TIME_EXPORT_DISPATCH_QUEUE;

export interface TimeExportDispatchDeps {
  sql: Sql;
  /** `enqueue(boss, "time.export", payload)`, injected to avoid an import cycle. */
  send: (payload: TimeExportPayload) => Promise<string | null>;
  logger: { info(obj: object): void };
}

export interface TimeExportDispatchReport {
  queued: number;
  enqueued: number;
  /** Already queued or running in pg-boss (its singleton key). */
  alreadyEnqueued: number;
}

/**
 * TIM-006 (issue #38): the API only inserts a `queued` row (the API has no
 * pg-boss). Every minute this sweep lists queued exports through the
 * owner-only SECURITY DEFINER function of migration 0045 (ids only, across
 * organizations) and enqueues one `time.export` job per row. The queue's
 * `exclusive` policy dedupes a row that is already waiting, so repeated
 * sweeps are harmless.
 */
export async function handleTimeExportDispatch(
  job: { id: string; data: unknown },
  deps: TimeExportDispatchDeps,
): Promise<TimeExportDispatchReport> {
  parsePayload(
    TIME_EXPORT_DISPATCH_QUEUE,
    TimeExportDispatchPayloadSchema,
    job.data,
  );
  const queued = await new TimeExportRepository().listQueued(
    deps.sql,
    TIME_EXPORT_DISPATCH_BATCH,
  );
  const report: TimeExportDispatchReport = {
    queued: queued.length,
    enqueued: 0,
    alreadyEnqueued: 0,
  };
  for (const row of queued) {
    const id = await deps.send({
      organizationId: row.organizationId,
      exportId: row.exportId,
    });
    if (id === null) report.alreadyEnqueued++;
    else report.enqueued++;
  }
  if (report.queued > 0) {
    deps.logger.info({
      msg: "time export dispatch finished",
      requirement: "TIM-006",
      jobId: job.id,
      ...report,
    });
  }
  return report;
}

/**
 * Installs the export sweeps: dispatch every minute (pg-boss's finest cron)
 * and file cleanup every hour. Independent of SCHEDULER_ENABLED: a requested
 * export must still run, and an expired file must still be deleted, when the
 * periodic per-organization jobs are switched off.
 */
export async function configureTimeExportSchedules(
  boss: Pick<ScheduleAdmin, "schedule">,
): Promise<void> {
  for (const [queue, cron] of [
    [TIME_EXPORT_DISPATCH_QUEUE, "* * * * *"],
    [TIME_EXPORT_CLEANUP_QUEUE, "7 * * * *"],
  ] as const) {
    await boss.schedule(
      queue,
      cron,
      {},
      { tz: "UTC", singletonKey: queue, missed: "once" },
    );
  }
}
