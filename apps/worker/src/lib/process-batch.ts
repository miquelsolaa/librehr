import type { JobResult } from "pg-boss";
import { JobError } from "./job-errors.js";

export interface BatchLogger {
  info(obj: object): void;
  error(obj: object): void;
}

export interface BatchJob<T> {
  id: string;
  data: T;
}

/**
 * Runs `handler` for every job in a pg-boss batch and reports one result per job, for use with
 * `work(name, { perJobResults: true }, ...)`. One failing job never prevents the others from
 * running or from being completed. Non-retryable `JobError`s are dead-lettered; anything else
 * is failed so pg-boss retries it per the queue policy.
 *
 * Only `JobError` messages are logged/stored: arbitrary errors (SMTP, DB) can embed PII such as
 * recipient addresses, so they are reduced to their class name.
 */
export async function processBatch<T>(
  queue: string,
  jobs: ReadonlyArray<BatchJob<T>>,
  handler: (job: BatchJob<T>) => Promise<unknown>,
  logger: BatchLogger,
): Promise<JobResult[]> {
  const results: JobResult[] = [];
  for (const job of jobs) {
    try {
      const output = await handler(job);
      results.push({ id: job.id, status: "completed", output });
    } catch (err) {
      const known = err instanceof JobError;
      const error = {
        name: err instanceof Error ? err.name : "UnknownError",
        message: known ? err.message : "unexpected error",
      };
      const status = known && !err.retryable ? "deadletter" : "failed";
      logger.error({ msg: "job failed", queue, jobId: job.id, status, error });
      results.push({ id: job.id, status, output: { error } });
    }
  }
  return results;
}
