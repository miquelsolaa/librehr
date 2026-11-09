import type { Logger } from "pino";
import { AuditVerifyChainPayloadSchema } from "../lib/enqueue.js";
import { NotImplementedError } from "../lib/job-errors.js";
import { parsePayload } from "../lib/payload.js";

export interface AuditVerifyChainPayload {
  organizationId: string;
  runDate: string;
}

/**
 * Background tamper-evident hash chain verification job (TIM-002).
 *
 * Fails loudly by design: the chain check is not implemented yet, and reporting "verified"
 * would claim tamper evidence that nobody checked. The job is dead-lettered with an explicit
 * "not implemented" error until TIM-002 lands, so operators can see and re-drive it.
 */
export async function handleAuditVerifyChain(
  job: { id: string; data: unknown },
  logger: Pick<Logger, "warn">,
): Promise<never> {
  const data = parsePayload(
    "audit.verify-chain",
    AuditVerifyChainPayloadSchema,
    job.data,
  );

  logger.warn({
    msg: "audit chain not verified: implementation deferred",
    requirement: "TIM-002",
    jobId: job.id,
    organizationId: data.organizationId,
    runDate: data.runDate,
  });
  throw new NotImplementedError("hash chain verification deferred (TIM-002)");
}
