import { z } from "zod";
import type { Logger } from "pino";
import { NotImplementedError } from "../lib/job-errors.js";
import { isoDate, parsePayload } from "../lib/payload.js";

export const TimeCloseDayPayloadSchema = z.object({
  organizationId: z.string().min(1),
  closeDate: z.string().regex(isoDate),
});

export type TimeCloseDayPayload = z.input<typeof TimeCloseDayPayloadSchema>;

export const timeCloseDaySingletonKey = (
  p: z.output<typeof TimeCloseDayPayloadSchema>,
) => `${p.organizationId}:${p.closeDate}`;

/**
 * Daily job to scan for unclosed clock-ins and trigger missing clock-out reminders (TIM-003).
 * Deduplicated at enqueue time by `timeCloseDaySingletonKey` (one job per organization and date).
 *
 * Fails loudly by design: the scan is not implemented yet, so reporting "completed" would hide
 * missed clock-out reminders. The job is dead-lettered until TIM-003 lands.
 */
export async function handleTimeCloseDay(
  job: { id: string; data: unknown },
  logger: Pick<Logger, "warn">,
): Promise<never> {
  const data = parsePayload(
    "time.close-day",
    TimeCloseDayPayloadSchema,
    job.data,
  );

  logger.warn({
    msg: "time close-day not performed: implementation deferred",
    requirement: "TIM-003",
    jobId: job.id,
    organizationId: data.organizationId,
    closeDate: data.closeDate,
  });
  throw new NotImplementedError("close-day scan deferred (TIM-003)");
}
