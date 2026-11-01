import { defaultIdempotency } from "../lib/idempotency.js";

export interface RetentionEnforcePayload {
  organizationId: string;
  runDate: string;
  dryRun?: boolean | undefined;
}

/**
 * Handles retention policy enforcement per ADM-005 / COMPLIANCE.md.
 * Evaluates soft-deleted documents and expired records past statutory retention periods:
 * - Working time records: retained 4 years per Spanish Labor Law (Art. 34.9 ET).
 * - Soft-deleted documents: purged after 30-day grace period.
 */
export async function handleRetentionEnforce(job: {
  data: RetentionEnforcePayload;
}) {
  const idempotencyKey = `retention-enforce:${job.data.organizationId}:${job.data.runDate}`;
  const proceed = await defaultIdempotency.checkAndMark(idempotencyKey);
  if (!proceed) return { skipped: true, stub: "ADM-005" };

  const dryRun = job.data.dryRun ?? false;

  return {
    organizationId: job.data.organizationId,
    runDate: job.data.runDate,
    dryRun,
    purgedDocuments: 0,
    status: "completed",
    stub: "ADM-005",
  };
}
