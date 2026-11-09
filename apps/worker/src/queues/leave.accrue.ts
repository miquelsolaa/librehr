import { z } from "zod";
import type { Logger } from "pino";
import { calculatePeriodicAccrual } from "@librehr/core";
import { MissingPolicyError, NotImplementedError } from "../lib/job-errors.js";
import { isoDate, parsePayload } from "../lib/payload.js";

export const LeaveAccruePayloadSchema = z.object({
  organizationId: z.string().min(1),
  runDate: z.string().regex(isoDate),
  // Policy values come from the organization's leave policy; they are never defaulted here.
  accrualMethod: z.enum(["upfront", "monthly", "daily"]).optional(),
  annualAllowanceDays: z.number().nonnegative().optional(),
  fteRatio: z.number().positive().max(1).optional(),
});

export type LeaveAccruePayload = z.input<typeof LeaveAccruePayloadSchema>;

export const leaveAccrueSingletonKey = (
  p: z.output<typeof LeaveAccruePayloadSchema>,
) => `${p.organizationId}:${p.runDate}`;

/**
 * Periodic leave accrual (LEA-002).
 *
 * Fails loudly by design: the append-only `leave_ledger` write is deferred to a separate PR, so
 * reporting success here would silently drop accruals. The pure computation in @librehr/core is
 * still exercised so the inputs are validated end to end, and the job is dead-lettered with an
 * explicit "not implemented" error that operators can see and re-drive once the ledger lands.
 */
export async function handleLeaveAccrue(
  job: { id: string; data: unknown },
  logger: Pick<Logger, "warn">,
): Promise<never> {
  const data = parsePayload("leave.accrue", LeaveAccruePayloadSchema, job.data);
  if (!data.accrualMethod) throw new MissingPolicyError("accrualMethod");
  if (data.annualAllowanceDays === undefined) {
    throw new MissingPolicyError("annualAllowanceDays");
  }

  const accruedAmount = calculatePeriodicAccrual({
    annualAllowance: data.annualAllowanceDays,
    accrualMethod: data.accrualMethod,
    month: Number(data.runDate.slice(5, 7)),
    ...(data.fteRatio !== undefined ? { fteRatio: data.fteRatio } : {}),
  });

  logger.warn({
    msg: "leave accrual computed but not persisted: ledger write deferred",
    requirement: "LEA-002",
    jobId: job.id,
    organizationId: data.organizationId,
    runDate: data.runDate,
    accrualMethod: data.accrualMethod,
    accruedAmount,
  });
  throw new NotImplementedError("ledger write deferred (LEA-002)");
}
