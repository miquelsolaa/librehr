import { z } from "zod";
import {
  planRetention,
  STATUTORY_DOCUMENT_CATEGORIES,
  type RetentionAction,
  type RetentionCategory,
  type RetentionPlanEntry,
} from "@librehr/core";
import {
  withTenant,
  AuditRepository,
  OrganizationRepository,
  RetentionRepository,
  type RetentionEligibleCounts,
  type Sql,
} from "@librehr/db";
import { isoDate, parsePayload } from "../lib/payload.js";

export const RetentionEnforcePayloadSchema = z.object({
  organizationId: z.guid(),
  runDate: z.string().regex(isoDate),
  /**
   * Accepted for compatibility with jobs already queued. Every run is a dry
   * run for now: no purge code path exists until counsel confirms the
   * periods (issue #32).
   */
  dryRun: z.boolean().optional(),
});

export type RetentionEnforcePayload = z.input<
  typeof RetentionEnforcePayloadSchema
>;

export const retentionEnforceSingletonKey = (
  p: z.output<typeof RetentionEnforcePayloadSchema>,
) => `${p.organizationId}:${p.runDate}`;

export const RETENTION_RUN_ACTION = "retention.run";

export interface RetentionEnforceDeps {
  sql: Sql;
  logger: { info(obj: object): void };
}

export interface RetentionCategoryReport {
  action: RetentionAction;
  retentionDays: number;
  source: RetentionPlanEntry["source"];
  /** First local day still kept, `YYYY-MM-DD`. */
  cutoffDate: string;
  /** Rows past the period. Counted, never deleted. */
  eligible: number;
}

export interface RetentionEnforceReport {
  organizationId: string;
  runDate: string;
  /** Always true: this release reports and never deletes. */
  dryRun: true;
  categories: Record<RetentionCategory, RetentionCategoryReport>;
}

/**
 * Which count of the repository each category reports. Statutory documents
 * become eligible through `deleted_documents` once both periods passed, so
 * `statutory_documents` reports the soft-deleted ones still held back.
 */
const COUNT_OF: Record<RetentionCategory, keyof RetentionEligibleCounts> = {
  time_records: "timeRecords",
  leave_records: "leaveRecords",
  audit_log: "auditLog",
  deleted_documents: "deletedDocuments",
  statutory_documents: "statutoryDocumentsHeld",
  notifications: "notifications",
  invitations: "invitations",
};

function entryFor(
  plan: readonly RetentionPlanEntry[],
  category: RetentionCategory,
): RetentionPlanEntry {
  const found = plan.find((e) => e.category === category);
  if (!found) throw new Error(`retention plan lacks ${category}`);
  return found;
}

/**
 * Retention dry-run report of one organization (ADM-005, issue #32).
 *
 * Plans every category from the organization's configured periods (or the
 * core defaults) in its time zone, counts the rows past each period and
 * writes one `retention.run` audit entry with those counts. Nothing is
 * deleted or anonymised: every category is `report_only`, and `dryRun: false`
 * in a payload changes nothing, because enabling purges waits for counsel to
 * confirm the periods.
 *
 * Re-running for the same runDate is safe (it only adds another audit
 * entry). The audit metadata, the job output and the logs hold ids, dates
 * and counts only, never names, titles or file names.
 */
export async function handleRetentionEnforce(
  job: { id: string; data: unknown },
  deps: RetentionEnforceDeps,
): Promise<RetentionEnforceReport> {
  const data = parsePayload(
    "retention.enforce",
    RetentionEnforcePayloadSchema,
    job.data,
  );
  const retentionRepo = new RetentionRepository();
  const orgRepo = new OrganizationRepository();
  const auditRepo = new AuditRepository();

  const report = await withTenant(
    deps.sql,
    { organizationId: data.organizationId },
    async (tx) => {
      const plan = planRetention({
        runDate: data.runDate,
        timeZone: await orgRepo.getBusinessTimeZone(tx),
        configured: await retentionRepo.listPolicies(tx),
      });
      const cutoff = (c: RetentionCategory) => entryFor(plan, c).cutoffInstant;
      const counts = await retentionRepo.countEligible(tx, {
        timeRecords: cutoff("time_records"),
        leaveRecords: entryFor(plan, "leave_records").cutoffDate,
        auditLog: cutoff("audit_log"),
        deletedDocuments: cutoff("deleted_documents"),
        statutoryDocuments: cutoff("statutory_documents"),
        statutoryDocumentCategories: STATUTORY_DOCUMENT_CATEGORIES,
        notifications: cutoff("notifications"),
        invitations: cutoff("invitations"),
      });

      const categories = Object.fromEntries(
        plan.map((e) => [
          e.category,
          {
            action: e.action,
            retentionDays: e.retentionDays,
            source: e.source,
            cutoffDate: e.cutoffDate,
            eligible: counts[COUNT_OF[e.category]],
          } satisfies RetentionCategoryReport,
        ]),
      ) as Record<RetentionCategory, RetentionCategoryReport>;

      await auditRepo.log(tx, {
        action: RETENTION_RUN_ACTION,
        resourceType: "organization",
        resourceId: data.organizationId,
        metadata: {
          runDate: data.runDate,
          dryRun: true,
          enforced: false,
          categories,
        },
      });
      return {
        organizationId: data.organizationId,
        runDate: data.runDate,
        dryRun: true as const,
        categories,
      };
    },
  );

  deps.logger.info({
    msg: "retention dry-run report finished",
    requirement: "ADM-005",
    jobId: job.id,
    organizationId: data.organizationId,
    runDate: data.runDate,
    eligible: Object.fromEntries(
      Object.entries(report.categories).map(([c, r]) => [c, r.eligible]),
    ),
  });
  return report;
}
