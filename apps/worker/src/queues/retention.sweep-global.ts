import { z } from "zod";
import { sweepPasswordResetTokens, type Sql } from "@librehr/db";
import { isoDateString, parsePayload } from "../lib/payload.js";

export const RetentionSweepGlobalPayloadSchema = z.object({
  /** UTC day the sweep runs for; one sweep per day across the instance. */
  runDate: isoDateString(),
});

export type RetentionSweepGlobalPayload = z.input<
  typeof RetentionSweepGlobalPayloadSchema
>;

export const retentionSweepGlobalSingletonKey = (
  p: z.output<typeof RetentionSweepGlobalPayloadSchema>,
) => p.runDate;

/** Retention of password reset links (migration 0040, COMPLIANCE.md §5). */
export const PASSWORD_RESET_TOKEN_RETENTION_DAYS = 30;

export interface RetentionSweepGlobalDeps {
  sql: Sql;
  logger: { info(obj: object): void };
}

export interface RetentionSweepGlobalReport {
  runDate: string;
  passwordResetTokensDeleted: number;
}

/**
 * Instance-wide retention sweep (ADM-005, issue #32): deletes password reset
 * links older than {@link PASSWORD_RESET_TOKEN_RETENTION_DAYS}, so an
 * instance where nobody requests a reset still purges them (the API only
 * sweeps on each request). The table is global, without RLS or tenant, so
 * this runs once per day for the instance, not per organization, and writes
 * no tenant audit entry; it logs the count only. Sessions are not swept.
 */
export async function handleRetentionSweepGlobal(
  job: { id: string; data: unknown },
  deps: RetentionSweepGlobalDeps,
): Promise<RetentionSweepGlobalReport> {
  const data = parsePayload(
    "retention.sweep-global",
    RetentionSweepGlobalPayloadSchema,
    job.data,
  );
  const deleted = await sweepPasswordResetTokens(
    deps.sql,
    PASSWORD_RESET_TOKEN_RETENTION_DAYS,
  );
  deps.logger.info({
    msg: "instance retention sweep finished",
    requirement: "ADM-005",
    jobId: job.id,
    runDate: data.runDate,
    passwordResetTokensDeleted: deleted,
  });
  return { runDate: data.runDate, passwordResetTokensDeleted: deleted };
}
