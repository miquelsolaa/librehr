import type { Sql } from "postgres";
import type { TenantTx } from "../with-tenant.js";

/** A configured period (a `retention_policies` row). */
export interface RetentionPolicyRow {
  category: string;
  retentionDays: number;
}

/**
 * Cutoffs of one retention run, from the core planner. A record is eligible
 * when its basis is strictly before the cutoff.
 */
export interface RetentionCountCutoffs {
  /** time_events.occurred_at */
  timeRecords: Date;
  /** employees.termination_date (local date, `YYYY-MM-DD`) */
  leaveRecords: string;
  /** audit_log.created_at */
  auditLog: Date;
  /** documents.deleted_at */
  deletedDocuments: Date;
  /**
   * documents.created_at: a soft-deleted document in one of
   * `statutoryDocumentCategories` created at or after this is held back.
   */
  statutoryDocuments: Date;
  statutoryDocumentCategories: readonly string[];
  /** notifications.created_at */
  notifications: Date;
  /** invitations.accepted_at, or expires_at when never accepted */
  invitations: Date;
}

/** Eligible row counts of one organization. Counts only, never content. */
export interface RetentionEligibleCounts {
  timeRecords: number;
  /** leave_requests plus leave_ledger rows of employees who left. */
  leaveRecords: number;
  auditLog: number;
  /** Soft-deleted documents past the grace and not held back. */
  deletedDocuments: number;
  /** Soft-deleted documents past the grace but held back (statutory). */
  statutoryDocumentsHeld: number;
  notifications: number;
  invitations: number;
}

/**
 * Reads for ADM-005 retention (issue #32). Report-only: nothing here deletes
 * tenant data. Every query is RLS-scoped through TenantTx and also filters on
 * the context's organization explicitly.
 */
export class RetentionRepository {
  async listPolicies(tx: TenantTx): Promise<RetentionPolicyRow[]> {
    return tx<RetentionPolicyRow[]>`
      SELECT category, retention_days AS "retentionDays"
      FROM retention_policies
      WHERE organization_id = ${tx.__tenantContext.organizationId}
      ORDER BY category
    `;
  }

  async countEligible(
    tx: TenantTx,
    cutoffs: RetentionCountCutoffs,
  ): Promise<RetentionEligibleCounts> {
    const org = tx.__tenantContext.organizationId;
    const statutory = [...cutoffs.statutoryDocumentCategories];
    const rows = await tx<Record<keyof RetentionEligibleCounts, number>[]>`
      SELECT
        (SELECT count(*) FROM time_events
          WHERE organization_id = ${org}
            AND occurred_at < ${cutoffs.timeRecords})::int AS "timeRecords",
        ((SELECT count(*) FROM leave_requests lr
            JOIN employees e ON e.id = lr.employee_id
            WHERE lr.organization_id = ${org}
              AND e.termination_date < ${cutoffs.leaveRecords}::date)
          + (SELECT count(*) FROM leave_ledger ll
            JOIN employees e ON e.id = ll.employee_id
            WHERE ll.organization_id = ${org}
              AND e.termination_date < ${cutoffs.leaveRecords}::date)
        )::int AS "leaveRecords",
        (SELECT count(*) FROM audit_log
          WHERE organization_id = ${org}
            AND created_at < ${cutoffs.auditLog})::int AS "auditLog",
        (SELECT count(*) FROM documents
          WHERE organization_id = ${org}
            AND deleted_at < ${cutoffs.deletedDocuments}
            AND NOT (category = ANY(${statutory}::text[])
              AND created_at >= ${cutoffs.statutoryDocuments})
        )::int AS "deletedDocuments",
        (SELECT count(*) FROM documents
          WHERE organization_id = ${org}
            AND deleted_at < ${cutoffs.deletedDocuments}
            AND category = ANY(${statutory}::text[])
            AND created_at >= ${cutoffs.statutoryDocuments}
        )::int AS "statutoryDocumentsHeld",
        (SELECT count(*) FROM notifications
          WHERE organization_id = ${org}
            AND created_at < ${cutoffs.notifications})::int AS "notifications",
        (SELECT count(*) FROM invitations
          WHERE organization_id = ${org}
            AND coalesce(accepted_at, expires_at) < ${cutoffs.invitations}
        )::int AS "invitations"
    `;
    const row = rows[0];
    if (!row) throw new Error("retention count returned no row");
    return row;
  }
}

/**
 * Instance-wide sweep of password reset links older than `olderThanDays`
 * (the 30-day retention of migration 0040). password_reset_tokens is a global
 * table without RLS, so this takes a plain connection, not a TenantTx.
 * Returns the number of rows deleted.
 */
export async function sweepPasswordResetTokens(
  sql: Sql,
  olderThanDays: number,
): Promise<number> {
  if (!Number.isInteger(olderThanDays) || olderThanDays < 1) {
    throw new RangeError("olderThanDays must be a positive integer");
  }
  const result = await sql`
    DELETE FROM password_reset_tokens
    WHERE created_at < now() - make_interval(days => ${olderThanDays}::int)
  `;
  return result.count;
}
