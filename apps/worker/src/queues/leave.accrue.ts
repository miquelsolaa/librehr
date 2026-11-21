import { z } from "zod";
import {
  accrualPeriodOf,
  planAccrual,
  type AccrualMethod,
} from "@librehr/core";
import {
  withTenant,
  loadEmploymentPeriods,
  LeaveAccrualRepository,
  type Sql,
} from "@librehr/db";
import { MissingPolicyError } from "../lib/job-errors.js";
import { isoDate, parsePayload } from "../lib/payload.js";

// Strict: jobs enqueued with the old policy fields fail loudly instead of
// having those values silently ignored.
export const LeaveAccruePayloadSchema = z.strictObject({
  organizationId: z.guid(),
  /** Business date in the organization's zone; its calendar month is accrued. */
  runDate: z.string().regex(isoDate),
});

export type LeaveAccruePayload = z.input<typeof LeaveAccruePayloadSchema>;

export const leaveAccrueSingletonKey = (
  p: z.output<typeof LeaveAccruePayloadSchema>,
) => `${p.organizationId}:${p.runDate}`;

const ACCRUAL_METHODS = new Set<string>(["upfront", "monthly", "daily"]);

/**
 * Part-time ratio applied to every accrual. Kept at 1 because no full-time
 * reference exists to divide `employments.working_hours_per_week` by, and
 * under Spanish law part-time staff are entitled to the same number of
 * vacation days (ET art. 12.4.d); see the PR for the open question.
 */
const FTE_RATIO = 1;

export interface LeaveAccrueDeps {
  sql: Sql;
  logger: { info(obj: object): void };
}

export interface LeaveAccrueReport {
  organizationId: string;
  period: string;
  assignments: number;
  written: number;
  alreadyAccrued: number;
}

/**
 * Periodic leave accrual (LEA-002): appends one `accrual` ledger entry per
 * policy assignment for the calendar month of `runDate`. Safe to re-run:
 * entries are keyed by `accrual:<policyId>:<YYYY-MM>` and a duplicate insert
 * is a no-op, so a retried or re-enqueued job never accrues twice.
 */
export async function handleLeaveAccrue(
  job: { id: string; data: unknown },
  deps: LeaveAccrueDeps,
): Promise<LeaveAccrueReport> {
  const data = parsePayload("leave.accrue", LeaveAccruePayloadSchema, job.data);
  const { period, monthEnd, yearStart, yearEnd } = accrualPeriodOf(
    data.runDate,
  );
  const repo = new LeaveAccrualRepository();

  const counts = await withTenant(
    deps.sql,
    { organizationId: data.organizationId },
    async (tx) => {
      // Upfront grants prorate over the whole year, so read from 1 January.
      const assignments = await repo.listAssignmentsOverlapping(
        tx,
        yearStart,
        monthEnd,
      );
      const employment = await loadEmploymentPeriods(
        tx,
        [...new Set(assignments.map((a) => a.employeeId))],
        yearStart,
        yearEnd,
      );

      let written = 0;
      let alreadyAccrued = 0;
      for (const a of assignments) {
        if (a.policyId === null || a.annualAllowanceDays === null) {
          throw new MissingPolicyError(
            `leave policy of assignment ${a.assignmentId}`,
          );
        }
        if (a.accrualMethod === null || !ACCRUAL_METHODS.has(a.accrualMethod)) {
          throw new MissingPolicyError(
            `accrual_method of policy ${a.policyId}`,
          );
        }
        // null: legacy employee without employment rows or termination date.
        const spans = employment.get(a.employeeId) ?? [
          { start: yearStart, end: null },
        ];
        const plan = planAccrual({
          policy: {
            id: a.policyId,
            annualAllowanceDays: a.annualAllowanceDays,
            accrualMethod: a.accrualMethod as AccrualMethod,
          },
          assignment: { start: a.start, end: a.end },
          employment: spans,
          fteRatio: FTE_RATIO,
          period,
        });
        if (plan === null) continue;
        const inserted = await repo.appendAccrualOnce(tx, {
          employeeId: a.employeeId,
          ...plan,
        });
        if (inserted) written++;
        else alreadyAccrued++;
      }
      return { assignments: assignments.length, written, alreadyAccrued };
    },
  );

  const report: LeaveAccrueReport = {
    organizationId: data.organizationId,
    period,
    ...counts,
  };
  // Ids and counts only: no names, emails or amounts per employee.
  deps.logger.info({
    msg: "leave accrual finished",
    requirement: "LEA-002",
    jobId: job.id,
    ...report,
  });
  return report;
}
