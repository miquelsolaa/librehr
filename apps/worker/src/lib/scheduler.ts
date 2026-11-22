import {
  dueScheduledJobs,
  type Clock,
  type DueJob,
  type ScheduledJob,
} from "@librehr/core";
import { SchedulerRepository, withTenant, type Sql } from "@librehr/db";
import { enqueue, prepareJob, type JobSender } from "./enqueue.js";
import type { TimeCloseDayPayload } from "../queues/time.close-day.js";
import type { AuditVerifyChainPayload } from "../queues/audit.verify-chain.js";
import type { RetentionEnforcePayload } from "../queues/retention.enforce.js";
import type { LeaveAccruePayload } from "../queues/leave.accrue.js";

export const SCHEDULER_TICK_QUEUE = "scheduler.tick";

/** Job states that mean "this period was already enqueued": all but cancelled. */
const ENQUEUED_STATES = new Set([
  "created",
  "retry",
  "active",
  "completed",
  "failed",
]);

export interface SchedulerConfig {
  enabled: boolean;
  /** pg-boss cron expression of the dispatcher tick, evaluated in UTC. */
  tickCron: string;
  graceMinutes: number;
  jobs: readonly ScheduledJob[];
}

/** The subset of PgBoss the dispatcher uses, so it can be faked in tests. */
export interface SchedulerBoss extends JobSender {
  findJobs(
    name: string,
    options: { key: string },
  ): Promise<ReadonlyArray<{ state: string }>>;
}

/** The subset of PgBoss used to install or remove the tick schedule. */
export interface ScheduleAdmin {
  schedule(
    name: string,
    cron: string,
    data: object,
    options: { tz: string; singletonKey: string; missed: "once" },
  ): Promise<void>;
  unschedule(name: string): Promise<void>;
  previewSchedule(cron: string, options: { tz: string; count: number }): Date[];
}

/** Longest allowed gap between ticks: well inside the 2-day catch-up window. */
export const MAX_TICK_GAP_HOURS = 24;

/**
 * Rejects a tick cron whose occurrences are more than
 * {@link MAX_TICK_GAP_HOURS} apart, since periods older than the catch-up
 * window would be skipped silently.
 */
export function assertTickCron(
  boss: Pick<ScheduleAdmin, "previewSchedule">,
  cron: string,
): void {
  const next = boss.previewSchedule(cron, { tz: "UTC", count: 400 });
  for (let i = 1; i < next.length; i++) {
    const gapMs = next[i]!.getTime() - next[i - 1]!.getTime();
    if (gapMs > MAX_TICK_GAP_HOURS * 3_600_000) {
      throw new Error(
        `SCHEDULER_TICK_CRON must run at least every ${MAX_TICK_GAP_HOURS} hours`,
      );
    }
  }
}

export interface SchedulerLogger {
  info(obj: object): void;
  error(obj: object): void;
}

export interface DispatchDeps {
  sql: Sql;
  boss: SchedulerBoss;
  logger: SchedulerLogger;
  config: Pick<SchedulerConfig, "enabled" | "graceMinutes" | "jobs">;
  clock: Clock;
}

export interface DispatchReport {
  organizations: number;
  /** New jobs sent to their queue. */
  enqueued: number;
  /** Periods already enqueued by an earlier tick (any state but cancelled). */
  alreadyEnqueued: number;
  /** Organizations skipped because of an error (logged by id). */
  failed: number;
  /** true when the scheduler is disabled and the tick did nothing. */
  disabled?: boolean;
}

type ScheduledPayload =
  | TimeCloseDayPayload
  | AuditVerifyChainPayload
  | RetentionEnforcePayload
  | LeaveAccruePayload;

/**
 * The payload of a due job. `retention.enforce` is always sent as a dry run:
 * switching scheduled purges on is a compliance decision for ADM-005
 * (COMPLIANCE.md section 5), not something the scheduler turns on by default.
 */
export function payloadFor(
  organizationId: string,
  due: DueJob,
): ScheduledPayload {
  switch (due.job) {
    case "time.close-day":
      return { organizationId, closeDate: due.date };
    case "retention.enforce":
      return { organizationId, runDate: due.date, dryRun: true };
    case "audit.verify-chain":
    case "leave.accrue":
      return { organizationId, runDate: due.date };
  }
}

/**
 * One scheduler tick (issue #115): for every organization, works out the
 * jobs due in its local time (`dueScheduledJobs`, organization and location
 * zones) and enqueues each one that was not enqueued before.
 *
 * Idempotent: a period is skipped when pg-boss still holds a job with its
 * singleton key in any state but cancelled (finished jobs are kept 3 days,
 * longer than the 2-day catch-up window), and the `exclusive` queue policy
 * rejects a concurrent duplicate. Handlers are idempotent as well, so a race
 * costs at most one redundant run.
 *
 * One organization's failure (e.g. an invalid time zone) is logged by id and
 * does not stop the others. Logs carry ids and counts only.
 */
export async function dispatchDueJobs(
  deps: DispatchDeps,
  jobId: string,
): Promise<DispatchReport> {
  if (!deps.config.enabled) {
    // A tick queued before the scheduler was disabled, or sent by hand.
    deps.logger.info({ msg: "scheduler tick ignored: disabled", jobId });
    return {
      organizations: 0,
      enqueued: 0,
      alreadyEnqueued: 0,
      failed: 0,
      disabled: true,
    };
  }
  const repo = new SchedulerRepository();
  const instant = deps.clock.now();
  const organizations = await repo.listOrganizations(deps.sql);
  const report: DispatchReport = {
    organizations: organizations.length,
    enqueued: 0,
    alreadyEnqueued: 0,
    failed: 0,
  };

  for (const org of organizations) {
    try {
      const locationZones = await withTenant(
        deps.sql,
        { organizationId: org.organizationId },
        (tx) => repo.listLocationTimeZones(tx),
      );
      const due = dueScheduledJobs({
        instant,
        timeZones: [org.timeZone, ...locationZones],
        graceMinutes: deps.config.graceMinutes,
        jobs: deps.config.jobs,
      });
      for (const d of due) {
        const payload = payloadFor(org.organizationId, d);
        const { singletonKey: key } = prepareJob(d.job, payload);
        const existing = await deps.boss.findJobs(d.job, { key });
        if (existing.some((j) => ENQUEUED_STATES.has(j.state))) {
          report.alreadyEnqueued++;
          continue;
        }
        const id = await enqueue(deps.boss, d.job, payload);
        if (id === null) report.alreadyEnqueued++;
        else report.enqueued++;
      }
    } catch (err) {
      report.failed++;
      deps.logger.error({
        msg: "scheduler skipped an organization",
        jobId,
        organizationId: org.organizationId,
        error: err instanceof Error ? err.name : "unknown",
      });
    }
  }

  deps.logger.info({ msg: "scheduler tick finished", jobId, ...report });
  return report;
}

/**
 * Installs the tick schedule in pg-boss, or removes it when the scheduler is
 * disabled. pg-boss stores schedules in the database, so disabling must
 * unschedule explicitly or the previous cron would keep firing.
 * `missed: "once"` sends one tick for occurrences missed while no worker ran;
 * the tick's catch-up window covers the periods that ended meanwhile.
 */
export async function configureSchedule(
  boss: ScheduleAdmin,
  config: Pick<SchedulerConfig, "enabled" | "tickCron">,
  logger: Pick<SchedulerLogger, "info">,
): Promise<void> {
  if (!config.enabled) {
    await boss.unschedule(SCHEDULER_TICK_QUEUE);
    logger.info({ msg: "job scheduler disabled (SCHEDULER_ENABLED=false)" });
    return;
  }
  assertTickCron(boss, config.tickCron);
  await boss.schedule(
    SCHEDULER_TICK_QUEUE,
    config.tickCron,
    {},
    { tz: "UTC", singletonKey: SCHEDULER_TICK_QUEUE, missed: "once" },
  );
  logger.info({
    msg: "job scheduler enabled",
    tickCron: config.tickCron,
  });
}
