import { z } from "zod";
import {
  accrualPeriodOf,
  accrualPlanPeriod,
  fteRatioFromHours,
  planAccrual,
  planFinalAccrual,
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
  type TenantTx,
} from "@librehr/db";
import {
  InvalidEmploymentDataError,
  MissingPolicyError,
} from "../lib/job-errors.js";
import {
  closeLeaveYear,
  expireCarryovers,
  type YearEndCounts,
} from "../lib/leave-year-end.js";
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
type AccrualMethod = z.infer<typeof AccrualMethodSchema>;

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

export interface AccrualCounts {
  /** Employee and policy pairs with a window in the year so far. */
  plans: number;
  written: number;
  /** Negative entries: more had been accrued than is due. */
  trueUps: number;
  /** This month's entry already existed (re-run). */
  alreadyAccrued: number;
  upToDate: number;
}

export interface LeaveAccrueReport extends AccrualCounts {
  organizationId: string;
  period: string;
  /**
   * January runs only: the previous year's final true-up (`accrual`) and
   * its close (carry-over and forfeit) per employee and leave type.
   */
  yearEnd: (AccrualCounts & YearEndCounts & { year: number }) | null;
  /** Carried-over days written off because their expiry date passed. */
  expiries: number;
}

interface PolicyPlan {
  employeeId: string;
  policyId: string;
  leaveTypeId: string;
  annualAllowanceDays: number;
  accrualMethod: AccrualMethod;
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

interface PassContext {
  tx: TenantTx;
  deps: LeaveAccrueDeps;
  logIds: Record<string, string>;
}

/**
 * Accrues one calendar month (`period`) for the policies `selected` keeps:
 * the year-to-date target minus what the ledger holds for the policy and
 * year, positive (`accrue`) or negative (true-up). `final` plans the whole
 * year of `period` under the `accrual:<policyId>:<YYYY>-final` ref.
 */
async function accruePass(
  ctx: PassContext,
  period: string,
  selected: (method: AccrualMethod) => boolean,
  final = false,
): Promise<AccrualCounts> {
  const { tx, deps } = ctx;
  const { monthEnd, yearStart, yearEnd } = accrualPeriodOf(`${period}-01`);
  const year = Number(yearStart.slice(0, 4));
  const repo = new LeaveAccrualRepository();
  const counts: AccrualCounts = {
    plans: 0,
    written: 0,
    trueUps: 0,
    alreadyAccrued: 0,
    upToDate: 0,
  };
  const logIds = { ...ctx.logIds, accrualPeriod: period };

  // Year to date: every window from 1 January to the end of the month.
  const plans = groupByPolicy(
    await repo.listAssignmentsOverlapping(tx, yearStart, monthEnd),
  ).filter((p) => selected(p.accrualMethod));
  if (plans.length === 0) return counts;
  counts.plans = plans.length;
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
    const input = {
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
      accruedCents: accrued.get(`${p.employeeId}:${p.policyId}`) ?? 0,
    };
    const plan = final
      ? planFinalAccrual({ ...input, year })
      : planAccrual({ ...input, period });
    if (plan.status === "up_to_date") {
      counts.upToDate++;
      continue;
    }
    // A negative entry is a true-up: it is an `accrual` too, so the
    // year-to-date sum stays equal to the target and the next run is
    // up to date (an `adjustment` would be invisible to that sum).
    const inserted = await repo.appendAccrualOnce(tx, {
      employeeId: p.employeeId,
      leaveTypeId: p.leaveTypeId,
      amount: plan.amount,
      sourceRef: plan.sourceRef,
      effectiveDate: plan.effectiveDate,
    });
    if (!inserted) counts.alreadyAccrued++;
    else if (plan.status === "over_accrued") counts.trueUps++;
    else counts.written++;
  }
  return counts;
}

/**
 * Periodic leave accrual, year-end close and carry-over expiry (LEA-002).
 * For the calendar month of `runDate`, in this order:
 *
 * 1. January runs only: the previous year's final true-up, then that year's
 *    close per employee and leave type (carry-over up to the policy's cap,
 *    forfeit of the rest), after expiring what was still carried into it.
 * 2. `monthly` and `daily` policies accrue the month of `runDate`; `upfront`
 *    policies are credited for the month that starts after it (issue #129),
 *    so the December run grants the next year's allowance on 1 January.
 *    Each is at most one `accrual` entry per employee, policy and month:
 *    the year-to-date target minus what the ledger already holds, negative
 *    when more was accrued than is due (true-up).
 * 3. Days carried over from the previous year whose expiry date has passed
 *    and that were not used expire.
 *
 * Safe to re-run: every entry has a deterministic `source_ref` that the
 * ledger accepts once per employee (indexes of migrations 0030 and 0036),
 * and a missed month is caught up by the next run.
 */
export async function handleLeaveAccrue(
  job: { id: string; data: unknown },
  deps: LeaveAccrueDeps,
): Promise<LeaveAccrueReport> {
  const data = parsePayload("leave.accrue", LeaveAccruePayloadSchema, job.data);
  const { period } = accrualPeriodOf(data.runDate);
  const runYear = Number(period.slice(0, 4));
  const isJanuary = period.endsWith("-01");
  const logIds = { requirement: "LEA-002", jobId: job.id, period };

  const result = await withTenant(
    deps.sql,
    { organizationId: data.organizationId },
    async (tx) => {
      const ctx: PassContext = { tx, deps, logIds };
      let yearEnd: LeaveAccrueReport["yearEnd"] = null;
      let expiries = 0;
      if (isJanuary) {
        const year = runYear - 1;
        const final = await accruePass(ctx, `${year}-12`, () => true, true);
        // Carry-over into `year` that is still unexpired (a missed run)
        // must expire before `year` is closed, or it would be carried again.
        expiries += await expireCarryovers(ctx, year - 1, data.runDate);
        const closed = await closeLeaveYear(ctx, year, data.runDate);
        yearEnd = { year, ...final, ...closed };
      }
      const accrual = await accruePass(
        ctx,
        period,
        (m) => accrualPlanPeriod(m, period) === period,
      );
      const upfrontPeriod = accrualPlanPeriod("upfront", period);
      const upfront = await accruePass(
        ctx,
        upfrontPeriod,
        (m) => accrualPlanPeriod(m, period) === upfrontPeriod,
      );
      expiries += await expireCarryovers(ctx, runYear - 1, data.runDate);
      return { accrual, upfront, yearEnd, expiries };
    },
  );

  const sum = (k: keyof AccrualCounts) => result.accrual[k] + result.upfront[k];
  const report: LeaveAccrueReport = {
    organizationId: data.organizationId,
    period,
    plans: sum("plans"),
    written: sum("written"),
    trueUps: sum("trueUps"),
    alreadyAccrued: sum("alreadyAccrued"),
    upToDate: sum("upToDate"),
    yearEnd: result.yearEnd,
    expiries: result.expiries,
  };
  // Ids and counts only: no names, emails or amounts per employee.
  deps.logger.info({ msg: "leave accrual finished", ...logIds, ...report });
  return report;
}
