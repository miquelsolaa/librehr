import { defaultIdempotency } from "../lib/idempotency.js";

export interface AuditVerifyChainPayload {
  organizationId: string;
  runDate: string;
}

// TODO(TIM-002): Background tamper-evident hash chain verification job
export async function handleAuditVerifyChain(job: {
  data: AuditVerifyChainPayload;
}) {
  const idempotencyKey = `audit-verify:${job.data.organizationId}:${job.data.runDate}`;
  const proceed = await defaultIdempotency.checkAndMark(idempotencyKey);
  if (!proceed) return { skipped: true };

  return { verifiedChains: 0, tamperedEvents: 0, stub: "TIM-002" };
}
