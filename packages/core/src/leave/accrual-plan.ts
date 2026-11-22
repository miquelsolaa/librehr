import { Temporal } from "temporal-polyfill";
import type { AccrualMethod } from "./types.js";
import { getDaysInYear } from "./accrual.js";

/** Inclusive local dates (`YYYY-MM-DD`); `end` is null while open. */
export interface AccrualSpan {
  start: string;
  end: string | null;
}

export interface AccrualTargetInput {
  /** Every number comes from the organization's `leave_policies` row. */
  policy: {
    id: string;
    annualAllowanceDays: number;
    accrualMethod: AccrualMethod;
  };
  /**
   * Every window in which this policy applies to the employee: from an
   * assignment's `effective_from` to the day before the next assignment for
   * the same leave type (null while it is the latest one).
   */
  assignments: readonly AccrualSpan[];
  /** Employment spans, already cut at the termination date. */
  employment: readonly AccrualSpan[];
  /** Full-time equivalent in (0, 1]. */
  fteRatio: number;
  /** Calendar month (`YYYY-MM`) in the organization's time zone. */
  period: string;
}

export interface AccrualPlanInput extends AccrualTargetInput {
  /** Sum of this policy's accrual entries of the period's year, in cents. */
  accruedCents: number;
}

export type AccrualPlan =
  | {
      status: "accrue";
      /** Days, 2 decimals (`leave_ledger.amount` is numeric(5,2)). */
      amount: number;
      /** `accrual:<policyId>:<YYYY-MM>`: at most one entry per month. */
      sourceRef: string;
      effectiveDate: string;
    }
  | { status: "up_to_date" }
  /**
   * More was accrued than is now due (e.g. a termination recorded late): a
   * negative `accrual` entry for the excess, under this month's `sourceRef`,
   * brings the policy's year back to its target (true-up).
   */
  | {
      status: "over_accrued";
      excessCents: number;
      /** Negative: `-excessCents / 100`. */
      amount: number;
      sourceRef: string;
      effectiveDate: string;
    };

export interface AccrualPeriod {
  /** `YYYY-MM` */
  period: string;
  monthStart: string;
  monthEnd: string;
  yearStart: string;
  yearEnd: string;
}

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * The accrual month of a run date and its bounds (local dates).
 *
 * @example
 * accrualPeriodOf("2028-02-10");
 * // => { period: "2028-02", monthStart: "2028-02-01", monthEnd: "2028-02-29",
 * //      yearStart: "2028-01-01", yearEnd: "2028-12-31" }
 */
export function accrualPeriodOf(runDate: string): AccrualPeriod {
  const day = Temporal.PlainDate.from(runDate);
  return {
    period: day.toPlainYearMonth().toString(),
    monthStart: day.with({ day: 1 }).toString(),
    monthEnd: day.with({ day: day.daysInMonth }).toString(),
    yearStart: `${day.year}-01-01`,
    yearEnd: `${day.year}-12-31`,
  };
}

/** `accrual:<policyId>:<YYYY>-`: prefix of a policy's entries in a year. */
export function accrualSourceRefPrefix(policyId: string, year: number): string {
  return `accrual:${policyId}:${year}-`;
}

interface Range {
  start: string;
  end: string;
}

const maxDate = (a: string, b: string) => (a > b ? a : b);
const minDate = (a: string, b: string) => (a < b ? a : b);
const dayAfter = (d: string) =>
  Temporal.PlainDate.from(d).add({ days: 1 }).toString();
const length = (r: Range) =>
  Temporal.PlainDate.from(r.start).until(Temporal.PlainDate.from(r.end)).days +
  1;

/**
 * Days covered by both an assignment window and an employment span, clipped
 * to [from, to] and merged, so overlapping rows never count a day twice.
 */
function activeRanges(
  input: AccrualTargetInput,
  from: string,
  to: string,
): Range[] {
  const clipped: Range[] = [];
  for (const job of input.employment) {
    for (const window of input.assignments) {
      const start = maxDate(maxDate(job.start, window.start), from);
      const end = minDate(minDate(job.end ?? to, window.end ?? to), to);
      if (start <= end) clipped.push({ start, end });
    }
  }
  clipped.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  const merged: Range[] = [];
  for (const r of clipped) {
    const last = merged[merged.length - 1];
    if (last && r.start <= dayAfter(last.end)) {
      last.end = maxDate(last.end, r.end);
    } else {
      merged.push({ ...r });
    }
  }
  return merged;
}

const daysIn = (ranges: readonly Range[], from: string, to: string) =>
  ranges.reduce((sum, r) => {
    const start = maxDate(r.start, from);
    const end = minDate(r.end, to);
    return start <= end ? sum + length({ start, end }) : sum;
  }, 0);

function validate(input: AccrualTargetInput): Temporal.PlainYearMonth {
  if (!PERIOD.test(input.period)) {
    throw new RangeError("period must be a calendar month (YYYY-MM)");
  }
  if (!(input.fteRatio > 0 && input.fteRatio <= 1)) {
    throw new RangeError("fteRatio must be in (0, 1]");
  }
  return Temporal.PlainYearMonth.from(input.period);
}

/**
 * Entitlement due for one policy from 1 January through the end of `period`,
 * in integer cents of a day (LEA-002). Rounded once, on the cumulative value,
 * so the monthly entries of a full year add up to the allowance exactly.
 *
 * - `upfront`: the whole year, prorated by the year's active days, from the
 *   employee's first active month of the year on.
 * - `monthly`: allowance / 12 per month, prorated by the active days of each
 *   month.
 * - `daily`: allowance × active days / days in the year (leap years count 366).
 *
 * Active days are covered by an employment span and a window of the policy.
 * The FTE ratio multiplies every method.
 *
 * @example
 * accrualTargetCents({
 *   policy: { id: "p1", annualAllowanceDays: 22, accrualMethod: "monthly" },
 *   assignments: [{ start: "2026-01-01", end: null }],
 *   employment: [{ start: "2020-01-01", end: null }],
 *   fteRatio: 1,
 *   period: "2026-12",
 * }); // => 2200
 */
export function accrualTargetCents(input: AccrualTargetInput): number {
  const month = validate(input);
  const allowanceCents = Math.round(input.policy.annualAllowanceDays * 100);
  if (!(allowanceCents > 0)) return 0;

  const year = month.year;
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const monthEnd = month.toPlainDate({ day: month.daysInMonth }).toString();
  const ranges = activeRanges(input, yearStart, yearEnd);
  if (ranges.length === 0) return 0;
  const daysInYear = getDaysInYear(year);

  let fraction: number;
  switch (input.policy.accrualMethod) {
    case "upfront":
      if (ranges[0]!.start > monthEnd) return 0;
      fraction = daysIn(ranges, yearStart, yearEnd) / daysInYear;
      break;
    case "daily":
      fraction = daysIn(ranges, yearStart, monthEnd) / daysInYear;
      break;
    case "monthly": {
      let months = 0;
      for (let m = 1; m <= month.month; m++) {
        const ym = Temporal.PlainYearMonth.from({ year, month: m });
        const from = ym.toPlainDate({ day: 1 }).toString();
        const to = ym.toPlainDate({ day: ym.daysInMonth }).toString();
        months += daysIn(ranges, from, to) / ym.daysInMonth;
      }
      fraction = months / 12;
      break;
    }
  }
  return Math.round(allowanceCents * fraction * input.fteRatio);
}

/**
 * Plans this month's accrual entry of one policy for one employee: the
 * year-to-date target minus what the ledger already holds for the policy and
 * year. A missed month is caught up by the next run, a policy whose method
 * changes mid-year never double counts, and re-running a month plans the
 * same `sourceRef`, which the ledger's unique index turns into a no-op.
 * When the ledger holds more than is due, the plan is a negative entry under
 * the same `sourceRef` (`over_accrued`), so a true-up is also once a month.
 *
 * The entry is dated on the employee's first active day in the month, or
 * their last active day before it when catching up after they left.
 *
 * @example
 * planAccrual({
 *   policy: { id: "p1", annualAllowanceDays: 24, accrualMethod: "monthly" },
 *   assignments: [{ start: "2026-01-01", end: null }],
 *   employment: [{ start: "2026-03-16", end: null }],
 *   fteRatio: 1,
 *   period: "2026-03",
 *   accruedCents: 0,
 * });
 * // => { status: "accrue", amount: 1.03, sourceRef: "accrual:p1:2026-03",
 * //      effectiveDate: "2026-03-16" }
 */
export function planAccrual(input: AccrualPlanInput): AccrualPlan {
  const diff = accrualTargetCents(input) - input.accruedCents;
  if (diff === 0) return { status: "up_to_date" };

  const month = Temporal.PlainYearMonth.from(input.period);
  const monthStart = month.toPlainDate({ day: 1 }).toString();
  const monthEnd = month.toPlainDate({ day: month.daysInMonth }).toString();
  const ranges = activeRanges(input, `${month.year}-01-01`, monthEnd);
  const inMonth = ranges.find((r) => r.end >= monthStart);
  // diff > 0 implies an active day on or before the month's end. A true-up
  // may find none (e.g. a hire date moved to a later year): month end.
  const effectiveDate = inMonth
    ? maxDate(inMonth.start, monthStart)
    : (ranges[ranges.length - 1]?.end ?? monthEnd);
  const sourceRef = `accrual:${input.policy.id}:${input.period}`;
  if (diff < 0) {
    return {
      status: "over_accrued",
      excessCents: -diff,
      amount: diff / 100,
      sourceRef,
      effectiveDate,
    };
  }
  return { status: "accrue", amount: diff / 100, sourceRef, effectiveDate };
}
