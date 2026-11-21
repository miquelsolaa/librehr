import { z } from "zod";
import { accrualPeriodOf, planAccrual, type AccrualSpan } from "@librehr/core";
import {
  withTenant,
  loadEmploymentPeriods,
  LeaveAccrualRepository,
  type AccrualAssignmentRow,
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

const AccrualMethodSchema = z.enum(["upfront", "monthly", "daily"]);

/**
 * Part-time ratio applied to every accrual. Kept at 1 because no full-time
 * reference exists to divide `employments.working_hours_per_week` by, and
 * under Spanish law part-time staff are entitled to the same number of
 * vacation days (ET art. 12.4.d); see the PR for the open question.
 */
const FTE_RATIO = 1;

export interface LeaveAccrueDeps {
  sql: Sql;
  logger: { info(obj: object): void; warn(obj: object): void };
}

export interface LeaveAccrueReport {
  organizationId: string;
  period: string;
  /** Employee and policy pairs with a window in the year so far. */
  plans: number;
  written: number;
  /** This month's entry already existed (re-run). */
  alreadyAccrued: number;
  upToDate: number;
  /** The ledger holds more than is now due; nothing written (no true-up yet). */
  overAccrued: number;
}

interface PolicyPlan {
  employeeId: string;
  policyId: string;
  annualAllowanceDays: number;
  accrualMethod: z.infer<typeof AccrualMethodSchema>;
  windows: AccrualSpan[];
}

/**
 * Groups the assignment windows by employee and policy, so a policy that
 * applies in two windows of the same month is planned once. Fails before any
 * write when an assignment points to a policy the tenant cannot see, or to a
 * policy whose accrual method is unknown.
 */
function groupByPolicy(rows: readonly AccrualAssignmentRow[]): PolicyPlan[] {
  const missing = rows.filter(
    (r) => r.policyId === null || r.annualAllowanceDays === null,
  );
  if (missing.length > 0) {
    const ids = missing.map((r) => r.assignmentId).join(", ");
    throw new MissingPolicyError(`leave policy of assignments ${ids}`);
  }

  const plans = new Map<string, PolicyPlan>();
  const badMethod = new Set<string>();
  for (const r of rows) {
    const policyId = r.policyId!;
    const method = AccrualMethodSchema.safeParse(r.accrualMethod);
    if (!method.success) {
      badMethod.add(policyId);
      continue;
    }
    const key = `${r.employeeId}:${policyId}`;
    const plan = plans.get(key) ?? {
      employeeId: r.employeeId,
      policyId,
      annualAllowanceDays: r.annualAllowanceDays!,
      accrualMethod: method.data,
      windows: [],
    };
    plan.windows.push({ start: r.start, end: r.end });
    plans.set(key, plan);
  }
  if (badMethod.size > 0) {
    throw new MissingPolicyError(
      `valid accrual_method of policies ${[...badMethod].join(", ")}`,
    );
  }
  return [...plans.values()];
}

/**
 * Periodic leave accrual (LEA-002). For the calendar month of `runDate`,
 * appends at most one `accrual` entry per employee and policy: the
 * year-to-date entitlement minus what the ledger already holds for that
 * policy and year. Safe to re-run (entries are keyed by
 * `accrual:<policyId>:<YYYY-MM>` and a duplicate insert is a no-op), and a
 * missed month is caught up by the next run.
 */
export async function handleLeaveAccrue(
  job: { id: string; data: unknown },
  deps: LeaveAccrueDeps,
): Promise<LeaveAccrueReport> {
  const data = parsePayload("leave.accrue", LeaveAccruePayloadSchema, job.data);
  const { period, monthEnd, yearStart, yearEnd } = accrualPeriodOf(
    data.runDate,
  );
  const year = Number(yearStart.slice(0, 4));
  const repo = new LeaveAccrualRepository();
  const counts = { written: 0, alreadyAccrued: 0, upToDate: 0, overAccrued: 0 };
  const logIds = { requirement: "LEA-002", jobId: job.id, period };

  const plans = await withTenant(
    deps.sql,
    { organizationId: data.organizationId },
    async (tx) => {
      // Year to date: every window from 1 January to the end of the month.
      const plans = groupByPolicy(
        await repo.listAssignmentsOverlapping(tx, yearStart, monthEnd),
      );
      const employment = await loadEmploymentPeriods(
        tx,
        [...new Set(plans.map((p) => p.employeeId))],
        yearStart,
        yearEnd,
      );
      const accrued = new Map(
        (await repo.listAccruedCents(tx, year)).map((r) => [
          `${r.employeeId}:${r.policyId}`,
          r.cents,
        ]),
      );

      for (const p of plans) {
        const spans = employment.get(p.employeeId);
        if (spans === undefined) {
          // Not returned for this tenant: never guess an employment period.
          deps.logger.warn({
            msg: "leave accrual skipped: employee not found",
            ...logIds,
            employeeId: p.employeeId,
          });
          continue;
        }
        const plan = planAccrual({
          policy: {
            id: p.policyId,
            annualAllowanceDays: p.annualAllowanceDays,
            accrualMethod: p.accrualMethod,
          },
          assignments: p.windows,
          // null: legacy employee with no employment rows and no termination
          // date, treated as employed while the policy applies.
          employment: spans ?? [{ start: yearStart, end: null }],
          fteRatio: FTE_RATIO,
          period,
          accruedCents: accrued.get(`${p.employeeId}:${p.policyId}`) ?? 0,
        });
        if (plan.status === "up_to_date") {
          counts.upToDate++;
        } else if (plan.status === "over_accrued") {
          counts.overAccrued++;
          deps.logger.warn({
            msg: "leave accrual: ledger holds more than is due, nothing written",
            ...logIds,
            employeeId: p.employeeId,
            policyId: p.policyId,
          });
        } else {
          const inserted = await repo.appendAccrualOnce(tx, {
            employeeId: p.employeeId,
            amount: plan.amount,
            sourceRef: plan.sourceRef,
            effectiveDate: plan.effectiveDate,
          });
          if (inserted) counts.written++;
          else counts.alreadyAccrued++;
        }
      }
      return plans.length;
    },
  );

  const report: LeaveAccrueReport = {
    organizationId: data.organizationId,
    period,
    plans,
    ...counts,
  };
  // Ids and counts only: no names, emails or amounts per employee.
  deps.logger.info({ msg: "leave accrual finished", ...logIds, ...report });
  return report;
}
