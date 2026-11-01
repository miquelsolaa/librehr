import { defaultIdempotency } from "../lib/idempotency.js";

export interface TimeCloseDayPayload {
  organizationId: string;
  closeDate: string; // YYYY-MM-DD
}

// TODO(TIM-003): Scan for unclosed clock-ins and trigger missing clock-out correction workflows
export async function handleTimeCloseDay(job: { data: TimeCloseDayPayload }) {
  const idempotencyKey = `time-close-day:${job.data.organizationId}:${job.data.closeDate}`;
  const proceed = await defaultIdempotency.checkAndMark(idempotencyKey);
  if (!proceed) return { skipped: true };

  return { missingClockOutsDetected: 0, stub: "TIM-003" };
}
