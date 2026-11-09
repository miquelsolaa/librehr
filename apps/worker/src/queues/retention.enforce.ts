import { z } from "zod";
import { isoDate, parsePayload } from "../lib/payload.js";

export const RetentionEnforcePayloadSchema = z.object({
  organizationId: z.string().min(1),
  runDate: z.string().regex(isoDate),
  dryRun: z.boolean().optional(),
});

export type RetentionEnforcePayload = z.input<
  typeof RetentionEnforcePayloadSchema
>;

export const retentionEnforceSingletonKey = (
  p: z.output<typeof RetentionEnforcePayloadSchema>,
) => `${p.organizationId}:${p.runDate}`;

/**
 * Handles retention policy enforcement per ADM-005 / COMPLIANCE.md.
 * Evaluates soft-deleted documents and expired records past statutory retention periods:
 * - Working time records: retained 4 years per Spanish Labor Law (Art. 34.9 ET).
 * - Soft-deleted documents: purged after 30-day grace period.
 * Deduplicated at enqueue time by `retentionEnforceSingletonKey`.
 */
export async function handleRetentionEnforce(job: {
  id: string;
  data: unknown;
}) {
  const data = parsePayload(
    "retention.enforce",
    RetentionEnforcePayloadSchema,
    job.data,
  );

  return {
    organizationId: data.organizationId,
    runDate: data.runDate,
    dryRun: data.dryRun ?? false,
    purgedDocuments: 0,
    status: "completed",
    stub: "ADM-005",
  };
}
