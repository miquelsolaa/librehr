import { z } from "zod";
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
 */
export async function handleTimeCloseDay(job: { id: string; data: unknown }) {
  const data = parsePayload(
    "time.close-day",
    TimeCloseDayPayloadSchema,
    job.data,
  );

  return {
    organizationId: data.organizationId,
    closeDate: data.closeDate,
    missingClockOutsDetected: 0,
    status: "completed",
    stub: "TIM-003",
  };
}
