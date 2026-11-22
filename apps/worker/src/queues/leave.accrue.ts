import { z } from "zod";
import {
  accrualPeriodOf,
  fteRatioFromHours,
  planAccrual,
  type AccrualSpan,
  type EmploymentAccrualSpan,
} from "@librehr/core";
import {
  withTenant,
  loadEmploymentPeriodsWithHours,
  LeaveAccrualRepository,
  type AccrualAssignmentRow,
  type EmploymentSpanWithHours,
  type Sql,
} from "@librehr/db";
import {
  InvalidEmploymentDataError,
  MissingPolicyError,
} from "../lib/job-errors.js";
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
 * Employment spans of one employee for one policy, each with its part-time
 * ratio (LEA-002, issue #118). A policy without a full-time week (the
 * default, and what statutory vacation requires: ET art. 12.4.d) is not
 * prorated. A legacy employee without employment rows has no recorded hours
 * and accrues at 1. Returns null when a stored hour figure is unusable.
 */
function prorated(
  spans: readonly EmploymentSpanWithHours[],
  fullTimeHoursPerWeek: number | null,
): EmploymentAccrualSpan[] | null {
  const result: EmploymentAccrualSpan[] = [];
  for (const span of spans) {
    if (fullTimeHoursPerWeek === null || span.hoursPerWeek === null) {
      result.push({ start: span.start, end: span.end });
      continue;
    }
    const hours = Number(span.hoursPerWeek);
    if (!(Number.isFinite(hours) && hours > 0)) return null;
    result.push({
      start: span.start,
      end: span.end,
      fteRatio: fteRatioFromHours(hours, fullTimeHoursPerWeek),
    });
  }
  return result;
}

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
  leaveTypeId: string;
  annualAllowanceDays: number;
  accrualMethod: z.infer<typeof AccrualMethodSchema>;
  fullTimeHoursPerWeek: number | null;
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
    (r) =>
      r.policyId === null ||
      r.leaveTypeId === null ||
      r.annualAllowanceDays === null,
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
      leaveTypeId: r.leaveTypeId!,
      annualAllowanceDays: r.annualAllowanceDays!,
      accrualMethod: method.data,
      fullTimeHoursPerWeek: r.fullTimeHoursPerWeek,
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
      const employment = await loadEmploymentPeriodsWithHours(
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

      // Every employment row a prorated policy reads must hold usable hours;
      // fail before any write, naming ids only.
      const badHours = new Set<string>();
      for (const p of plans) {
        const spans = employment.get(p.employeeId);
        if (spans && prorated(spans, p.fullTimeHoursPerWeek) === null)
          badHours.add(p.employeeId);
      }
      if (badHours.size > 0) {
        throw new InvalidEmploymentDataError("working_hours_per_week", [
          ...badHours,
        ]);
      }

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
          employment: spans
            ? prorated(spans, p.fullTimeHoursPerWeek)!
            : [{ start: yearStart, end: null }],
          fteRatio: 1,
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
            leaveTypeId: p.leaveTypeId,
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
