import { Temporal } from "temporal-polyfill";

/**
 * Which periodic jobs are due for one organization at an instant (issue #115).
 *
 * Every scheduled job covers a period of local calendar days that has ended:
 * a day (`time.close-day`, `audit.verify-chain`, `retention.enforce`) or a
 * month (`leave.accrue`). A period is due once the local midnight after its
 * last day, plus a grace period, has passed in **every** time zone the
 * organization uses (its own and its locations'), so no employee's day is
 * closed while it is still running (e.g. Atlantic/Canary is an hour behind
 * Europe/Madrid).
 *
 * A tick returns the periods that ended within the last
 * {@link SCHEDULER_CATCH_UP_DAYS} closed local days, so ticks missed while
 * the worker was down are caught up. The same period is returned by every
 * tick inside that window: the caller dedupes by the job's singleton key.
 */

export const SCHEDULED_JOBS = [
  "time.close-day",
  "audit.verify-chain",
  "retention.enforce",
  "leave.accrue",
] as const;

export type ScheduledJob = (typeof SCHEDULED_JOBS)[number];

/**
 * Closed local days a tick looks back over. Kept below the 3 days pg-boss
 * keeps finished jobs (`QUEUE_RETENTION.deleteAfterSeconds` in the worker),
 * because the dispatcher relies on those rows to skip periods it already
 * enqueued.
 */
export const SCHEDULER_CATCH_UP_DAYS = 2;

/** Grace after local midnight is capped at half a day. */
export const SCHEDULER_MAX_GRACE_MINUTES = 720;

export interface DueJob {
  job: ScheduledJob;
  /**
   * Last local day of the period, `YYYY-MM-DD`: the `closeDate` of
   * `time.close-day`, the `runDate` of the other jobs. For `leave.accrue` it
   * is the last day of the month, whose month the handler accrues.
   */
  date: string;
}

export interface DueJobsInput {
  instant: Date;
  /** IANA zones the organization uses; the first is the organization's. */
  timeZones: readonly string[];
  graceMinutes: number;
  /** Jobs to consider; all of {@link SCHEDULED_JOBS} when omitted. */
  jobs?: readonly ScheduledJob[];
}

function assertGrace(graceMinutes: number): void {
  if (
    !Number.isInteger(graceMinutes) ||
    graceMinutes < 0 ||
    graceMinutes > SCHEDULER_MAX_GRACE_MINUTES
  ) {
    throw new RangeError(
      `graceMinutes must be an integer from 0 to ${SCHEDULER_MAX_GRACE_MINUTES}`,
    );
  }
}

/**
 * The latest local day that has ended, plus `graceMinutes`, in every one of
 * `timeZones`. DST-aware: the grace is elapsed time, so on a 23 or 25 hour
 * day the boundary is still local midnight plus the grace.
 *
 * @example
 * // 00:20 in Madrid on 1 March 2028 (UTC+1), 30 minutes of grace:
 * lastClosedLocalDate(new Date("2028-02-29T23:20:00Z"), ["Europe/Madrid"], 30);
 * // => "2028-02-28" (29 February closes at 00:30)
 */
export function lastClosedLocalDate(
  instant: Date,
  timeZones: readonly string[],
  graceMinutes: number,
): string {
  assertGrace(graceMinutes);
  if (timeZones.length === 0) {
    throw new RangeError("at least one time zone is required");
  }
  const shifted = Temporal.Instant.fromEpochMilliseconds(
    instant.getTime(),
  ).subtract({ minutes: graceMinutes });
  let earliest: Temporal.PlainDate | null = null;
  for (const zone of timeZones) {
    const local = shifted.toZonedDateTimeISO(zone).toPlainDate();
    if (earliest === null || Temporal.PlainDate.compare(local, earliest) < 0) {
      earliest = local;
    }
  }
  // `earliest` is the first local day that has not closed everywhere yet.
  return earliest!.subtract({ days: 1 }).toString();
}

/**
 * The jobs due for an organization at `instant`, oldest period first. Pure
 * and deterministic: calling it again at the same or a later instant within
 * the catch-up window returns the same periods again.
 *
 * @example
 * // 00:45 in Madrid on 1 November 2026, 30 minutes of grace:
 * dueScheduledJobs({
 *   instant: new Date("2026-10-31T23:45:00Z"),
 *   timeZones: ["Europe/Madrid"],
 *   graceMinutes: 30,
 *   jobs: ["time.close-day", "leave.accrue"],
 * });
 * // => [{ job: "time.close-day", date: "2026-10-30" },
 * //     { job: "time.close-day", date: "2026-10-31" },
 * //     { job: "leave.accrue", date: "2026-10-31" }]
 */
export function dueScheduledJobs(input: DueJobsInput): DueJob[] {
  const jobs = new Set<ScheduledJob>(input.jobs ?? SCHEDULED_JOBS);
  const last = Temporal.PlainDate.from(
    lastClosedLocalDate(input.instant, input.timeZones, input.graceMinutes),
  );
  const due: DueJob[] = [];
  for (let back = SCHEDULER_CATCH_UP_DAYS - 1; back >= 0; back--) {
    const day = last.subtract({ days: back });
    const date = day.toString();
    for (const job of SCHEDULED_JOBS) {
      if (!jobs.has(job)) continue;
      if (job === "leave.accrue") {
        // Monthly: due once the month's last day has closed.
        if (day.day === day.daysInMonth) due.push({ job, date });
      } else {
        due.push({ job, date });
      }
    }
  }
  return due;
}
