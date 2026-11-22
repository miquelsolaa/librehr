import { z } from "zod";
import { parsePayload } from "../lib/payload.js";

/**
 * The dispatcher job that pg-boss runs on the tick cron (issue #115). It
 * carries no data: everything is derived from the clock and the database.
 */
export const SchedulerTickPayloadSchema = z.strictObject({});

export type SchedulerTickPayload = z.input<typeof SchedulerTickPayloadSchema>;

/**
 * Constant key: with the `exclusive` queue policy at most one tick is queued
 * or running at a time, so a slow tick never overlaps the next one.
 */
export const schedulerTickSingletonKey = (): string => "scheduler.tick";

/**
 * Validates the (empty) payload and runs one dispatch. The dispatch itself
 * lives in `lib/scheduler.ts`, injected here to keep `enqueue.ts` (which
 * lists this queue) free of an import cycle.
 */
export async function handleSchedulerTick<R>(
  job: { id: string; data: unknown },
  dispatch: (jobId: string) => Promise<R>,
): Promise<R> {
  parsePayload("scheduler.tick", SchedulerTickPayloadSchema, job.data);
  return dispatch(job.id);
}
