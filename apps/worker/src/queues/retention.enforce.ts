import { defaultIdempotency } from "../lib/idempotency.js";

export interface RetentionEnforcePayload {
  organizationId: string;
  runDate: string;
  dryRun?: boolean | undefined;
}

// TODO(ADM-005): Enforce GDPR retention limits and dry-run erasure reporting
export async function handleRetentionEnforce(job: {
  data: RetentionEnforcePayload;
}) {
  const idempotencyKey = `retention-enforce:${job.data.organizationId}:${job.data.runDate}`;
  const proceed = await defaultIdempotency.checkAndMark(idempotencyKey);
  if (!proceed) return { skipped: true };

  return { purgedRecords: 0, stub: "ADM-005" };
}
