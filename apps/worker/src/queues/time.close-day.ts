import { defaultIdempotency } from "../lib/idempotency.js";

export interface TimeCloseDayPayload {
  organizationId: string;
  closeDate: string; // YYYY-MM-DD
}

/**
 * Daily job to scan for unclosed clock-ins and trigger missing clock-out reminders (TIM-003).
 * Strictly idempotent per organization and date.
 */
export async function handleTimeCloseDay(job: { data: TimeCloseDayPayload }) {
  const idempotencyKey = `time-close-day:${job.data.organizationId}:${job.data.closeDate}`;
  const proceed = await defaultIdempotency.checkAndMark(idempotencyKey);
  if (!proceed) return { skipped: true, stub: "TIM-003" };

  return {
    organizationId: job.data.organizationId,
    closeDate: job.data.closeDate,
    missingClockOutsDetected: 0,
    status: "completed",
    stub: "TIM-003",
  };
}
