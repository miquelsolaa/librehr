/**
 * Retention categories for ADM-005 (issue #32).
 *
 * Single source for the categories the retention job reports on, their
 * default periods and their legal floors. Migration 0042 mirrors the category
 * list and the floors as CHECK constraints on `retention_policies`, so the
 * API, the worker and the database agree.
 *
 * Every period except the `time_records` floor is a default that an
 * organization can change (a row in `retention_policies`). The defaults are
 * the maintainers' recommendation and are pending confirmation by counsel
 * (COMPLIANCE.md section 5); none of them is legal advice.
 *
 * Every category is `report_only` for now: the job counts what would be
 * eligible and deletes nothing. Enabling deletion is a separate, counsel-gated
 * change.
 */

export const RETENTION_CATEGORIES = [
  "time_records",
  "leave_records",
  "audit_log",
  "deleted_documents",
  "statutory_documents",
  "notifications",
  "invitations",
] as const;

export type RetentionCategory = (typeof RETENTION_CATEGORIES)[number];

/** What enforcement may do once a record is past its period. */
export type RetentionAction = "delete" | "report_only";

/**
 * The date a period is measured from:
 * - `occurred_at`: when the recorded fact happened (a clock event);
 * - `created_at`: when the row was written;
 * - `deleted_at`: when a user soft-deleted it (DOC-001);
 * - `employment_end`: the employee's termination date;
 * - `closed_at`: when an invitation was accepted or expired.
 */
export type RetentionBasis =
  "occurred_at" | "created_at" | "deleted_at" | "employment_end" | "closed_at";

export interface RetentionCategoryDefinition {
  /** Minimum the law requires, in days; `null` when no floor applies. */
  legalMinimumDays: number | null;
  /** Default period in days when the organization configured none. */
  defaultDays: number;
  action: RetentionAction;
  basis: RetentionBasis;
}

/** Upper bound of a configured period (about 100 years). */
export const RETENTION_MAX_DAYS = 36525;

/** Four calendar years, including one leap day. */
const FOUR_YEARS_DAYS = 1461;

/**
 * Document categories an employer usually has to keep for years after issue
 * (tax and Social Security periods). A soft-deleted document in one of them
 * is held back until it is older than the `statutory_documents` period, even
 * once its `deleted_documents` grace has passed (decision 2B on issue #32).
 */
export const STATUTORY_DOCUMENT_CATEGORIES = ["contracts", "payslips"] as const;

export const RETENTION_CATEGORY_DEFINITIONS: Readonly<
  Record<RetentionCategory, RetentionCategoryDefinition>
> = {
  // Estatuto de los Trabajadores art. 34.9: time records are kept 4 years.
  // Report-only: deleting breaks the TIM-002 hash chain (follow-up issue).
  time_records: {
    legalMinimumDays: FOUR_YEARS_DAYS,
    defaultDays: FOUR_YEARS_DAYS,
    action: "report_only",
    basis: "occurred_at",
  },
  // Needs ADM-004 anonymization before anything can be removed.
  leave_records: {
    legalMinimumDays: null,
    defaultDays: FOUR_YEARS_DAYS,
    action: "report_only",
    basis: "employment_end",
  },
  // Append-only audit trail; deletion needs its own design (follow-up).
  audit_log: {
    legalMinimumDays: null,
    defaultDays: 1095,
    action: "report_only",
    basis: "created_at",
  },
  // Grace period after a DOC-001 soft delete.
  deleted_documents: {
    legalMinimumDays: null,
    defaultDays: 30,
    action: "report_only",
    basis: "deleted_at",
  },
  // Hold-back for soft-deleted STATUTORY_DOCUMENT_CATEGORIES documents.
  statutory_documents: {
    legalMinimumDays: null,
    defaultDays: FOUR_YEARS_DAYS,
    action: "report_only",
    basis: "created_at",
  },
  notifications: {
    legalMinimumDays: null,
    defaultDays: 365,
    action: "report_only",
    basis: "created_at",
  },
  // Accepted or expired invitations.
  invitations: {
    legalMinimumDays: null,
    defaultDays: 90,
    action: "report_only",
    basis: "closed_at",
  },
};

export function isRetentionCategory(value: string): value is RetentionCategory {
  return (RETENTION_CATEGORIES as readonly string[]).includes(value);
}

/**
 * Throws a RangeError unless `days` is a whole number of days from the
 * category's legal floor (or 1) up to {@link RETENTION_MAX_DAYS}. Callers
 * that accept a period from a user validate it with this before storing it.
 *
 * @example
 * assertRetentionDays("notifications", 180); // ok
 * assertRetentionDays("time_records", 365); // throws: below the 4-year floor
 */
export function assertRetentionDays(
  category: RetentionCategory,
  days: number,
): void {
  const floor = RETENTION_CATEGORY_DEFINITIONS[category].legalMinimumDays ?? 1;
  if (!Number.isInteger(days) || days < floor || days > RETENTION_MAX_DAYS) {
    throw new RangeError(
      `retention days for ${category} must be an integer from ${floor} to ${RETENTION_MAX_DAYS}`,
    );
  }
}
