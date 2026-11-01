import { defaultIdempotency } from "../lib/idempotency.js";
import { calculatePeriodicAccrual } from "@openhr/core";

export interface LeaveAccruePayload {
  organizationId: string;
  runDate: string; // YYYY-MM-DD
  accrualMethod?: "upfront" | "monthly" | "daily";
  annualAllowanceDays?: number;
  fteRatio?: number;
}

/**
 * Handles periodic leave accrual per employee policy (LEA-002).
 * Strictly idempotent via pg-boss job key.
 */
export async function handleLeaveAccrue(job: { data: LeaveAccruePayload }) {
  const method = job.data.accrualMethod ?? "monthly";
  const idempotencyKey = `leave-accrue:${job.data.organizationId}:${job.data.runDate}:${method}`;
  const proceed = await defaultIdempotency.checkAndMark(idempotencyKey);
  if (!proceed) return { skipped: true, stub: "LEA-002" };

  const month = parseInt(job.data.runDate.slice(5, 7), 10) || 1;
  const accruedAmount = calculatePeriodicAccrual({
    annualAllowance: job.data.annualAllowanceDays ?? 22.0,
    accrualMethod: method,
    month,
    fteRatio: job.data.fteRatio ?? 1.0,
  });

  return {
    organizationId: job.data.organizationId,
    runDate: job.data.runDate,
    accrualMethod: method,
    accruedAmount,
    status: "completed",
    stub: "LEA-002",
  };
}
