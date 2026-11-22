import { Temporal } from "temporal-polyfill";
import type { AccrualMethod } from "./types.js";
import {
  planAccrual,
  type AccrualPlan,
  type AccrualTargetInput,
} from "./accrual-plan.js";

/**
 * Which accrual month a monthly run plans for a policy (LEA-002, issue #129).
 *
 * The scheduler runs `leave.accrue` once a month has ended. `monthly` and
 * `daily` policies earn days as time passes, so the run accrues the month
 * that ended. An `upfront` policy grants its allowance when the year (or the
 * employment) starts, so the same run credits the month that is starting:
 * the run for December credits January of the next year at 00:00 on
 * 1 January, instead of after January has ended.
 *
 * The planned month names the `accrual:<policyId>:<YYYY-MM>` source ref, so
 * a re-run is still a no-op.
 *
 * @example
 * accrualPlanPeriod("monthly", "2026-12"); // => "2026-12"
 * accrualPlanPeriod("upfront", "2026-12"); // => "2027-01"
 */
export function accrualPlanPeriod(
  method: AccrualMethod,
  runPeriod: string,
): string {
  const month = Temporal.PlainYearMonth.from(runPeriod);
  return method === "upfront"
    ? month.add({ months: 1 }).toString()
    : month.toString();
}

/**
 * `accrual:<policyId>:<YYYY>-final`: the one entry that settles a year after
 * it has ended. It still matches `accrualSourceRefPrefix(policyId, year)`, so
 * it counts toward that year's accrued total.
 */
export function finalAccrualSourceRef(policyId: string, year: number): string {
  return `accrual:${policyId}:${year}-final`;
}

/**
 * The final true-up of a policy's year, planned by the first run of the next
 * year (the January run) before the year is closed for carry-over. It
 * compares the whole year's target with what the ledger holds and plans the
 * difference, positive or negative, under `finalAccrualSourceRef`. This
 * writes a December change recorded after December was accrued (a backdated
 * hire, termination or assignment) and a December run that was missed.
 *
 * @example
 * planFinalAccrual({
 *   policy: { id: "p1", annualAllowanceDays: 24, accrualMethod: "monthly" },
 *   assignments: [{ start: "2026-01-01", end: null }],
 *   // Termination on 30 November, recorded after December was accrued.
 *   employment: [{ start: "2020-01-01", end: "2026-11-30" }],
 *   fteRatio: 1,
 *   year: 2026,
 *   accruedCents: 2400,
 * });
 * // => { status: "over_accrued", excessCents: 200, amount: -2,
 * //      sourceRef: "accrual:p1:2026-final", effectiveDate: "2026-11-30" }
 */
export function planFinalAccrual(
  input: Omit<AccrualTargetInput, "period"> & {
    year: number;
    accruedCents: number;
  },
): AccrualPlan {
  const { year, ...rest } = input;
  if (!Number.isInteger(year)) throw new RangeError("year must be an integer");
  const plan = planAccrual({ ...rest, period: `${year}-12` });
  return plan.status === "up_to_date"
    ? plan
    : { ...plan, sourceRef: finalAccrualSourceRef(input.policy.id, year) };
}
