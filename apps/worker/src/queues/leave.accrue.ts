import { defaultIdempotency } from "../lib/idempotency.js";

export interface LeaveAccruePayload {
  organizationId: string;
  runDate: string; // YYYY-MM-DD
}

// TODO(LEA-002): Accrue leave daily per employee policy and organization timezone
export async function handleLeaveAccrue(job: { data: LeaveAccruePayload }) {
  const idempotencyKey = `leave-accrue:${job.data.organizationId}:${job.data.runDate}`;
  const proceed = await defaultIdempotency.checkAndMark(idempotencyKey);
  if (!proceed) return { skipped: true };

  return { accruedEmployees: 0, stub: "LEA-002" };
}
