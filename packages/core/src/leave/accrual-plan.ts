import { Temporal } from "temporal-polyfill";
import type { AccrualMethod } from "./types.js";
import { getDaysInYear } from "./accrual.js";

/** Inclusive local dates (`YYYY-MM-DD`); `end` is null while open. */
export interface AccrualSpan {
  start: string;
  end: string | null;
}

export interface AccrualPlanInput {
  /** Every number comes from the organization's `leave_policies` row. */
  policy: {
    id: string;
    annualAllowanceDays: number;
    accrualMethod: AccrualMethod;
  };
  /**
   * Dates the policy applies to the employee: from the assignment's
   * `effective_from` to the day before the next assignment for the same leave
   * type (null while it is the latest one).
   */
  assignment: AccrualSpan;
  /** Employment spans, already cut at the termination date. */
  employment: readonly AccrualSpan[];
  /** Full-time equivalent in (0, 1]. */
  fteRatio: number;
  /** Calendar month (`YYYY-MM`) in the organization's time zone. */
  period: string;
}

export interface AccrualPlan {
  /** Days, rounded to 2 decimals (`leave_ledger.amount` is numeric(5,2)). */
  amount: number;
  /** `accrual:<policyId>:<YYYY-MM>`: one accrual per policy and month. */
  sourceRef: string;
  /** First active day of the employee in the accrued range. */
  effectiveDate: string;
}

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

export interface AccrualPeriod {
  /** `YYYY-MM` */
  period: string;
  monthStart: string;
  monthEnd: string;
  yearStart: string;
  yearEnd: string;
}

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

interface ActiveDays {
  days: number;
  first: string;
}

/**
 * Days in [from, to] covered by both the assignment and an employment span.
 * Spans are merged first, so overlapping employment rows never count a day
 * twice. Null when no day is covered.
 */
function activeDaysIn(
  assignment: AccrualSpan,
  employment: readonly AccrualSpan[],
  from: string,
  to: string,
): ActiveDays | null {
  const clipped: { start: string; end: string }[] = [];
  for (const span of employment) {
    const start = [span.start, assignment.start, from].reduce((a, b) =>
      a > b ? a : b,
    );
    const end = [span.end ?? to, assignment.end ?? to, to].reduce((a, b) =>
      a < b ? a : b,
    );
    if (start <= end) clipped.push({ start, end });
  }
  if (clipped.length === 0) return null;
  clipped.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));

  let days = 0;
  let current = clipped[0]!;
  const count = (s: { start: string; end: string }) =>
    Temporal.PlainDate.from(s.start).until(Temporal.PlainDate.from(s.end))
      .days + 1;
  for (const span of clipped.slice(1)) {
    const dayAfter = Temporal.PlainDate.from(current.end)
      .add({ days: 1 })
      .toString();
    if (span.start <= dayAfter) {
      if (span.end > current.end) current = { ...current, end: span.end };
    } else {
      days += count(current);
      current = span;
    }
  }
  days += count(current);
  return { days, first: clipped[0]!.start };
}

/**
 * Plans the accrual ledger entry of one policy assignment for one calendar
 * month (LEA-002), or null when nothing accrues.
 *
 * - `upfront`: the whole year's allowance, prorated by the active days of the
 *   year known today, in the employee's first active month of the year
 *   (January, or the start month for a mid-year joiner).
 * - `monthly`: allowance / 12 per month, prorated by the active days of a
 *   month in which the employee starts, leaves or changes policy.
 * - `daily`: allowance × active days in the month / days in the year, so a
 *   full year adds up to the allowance in leap and common years alike.
 *
 * Every amount is multiplied by the FTE ratio. Pure: deterministic for the
 * same input, so a re-run plans the same `sourceRef` and the ledger's unique
 * index turns it into a no-op.
 *
 * @example
 * planAccrual({
 *   policy: { id: "p1", annualAllowanceDays: 24, accrualMethod: "monthly" },
 *   assignment: { start: "2026-01-01", end: null },
 *   employment: [{ start: "2026-03-16", end: null }],
 *   fteRatio: 1,
 *   period: "2026-03",
 * });
 * // => { amount: 1.03, sourceRef: "accrual:p1:2026-03", effectiveDate: "2026-03-16" }
 */
export function planAccrual(input: AccrualPlanInput): AccrualPlan | null {
  const { policy, assignment, employment, fteRatio, period } = input;
  if (!PERIOD.test(period)) {
    throw new RangeError("period must be a calendar month (YYYY-MM)");
  }
  if (!(fteRatio > 0 && fteRatio <= 1)) {
    throw new RangeError("fteRatio must be in (0, 1]");
  }
  const allowance = policy.annualAllowanceDays;
  if (!Number.isFinite(allowance) || allowance <= 0) return null;

  const month = Temporal.PlainYearMonth.from(period);
  const monthStart = month.toPlainDate({ day: 1 }).toString();
  const monthEnd = month.toPlainDate({ day: month.daysInMonth }).toString();
  const daysInYear = getDaysInYear(month.year);

  let raw: number;
  let effectiveDate: string;
  if (policy.accrualMethod === "upfront") {
    const year = activeDaysIn(
      assignment,
      employment,
      `${month.year}-01-01`,
      `${month.year}-12-31`,
    );
    if (year === null || year.first.slice(0, 7) !== period) return null;
    raw = (allowance * year.days) / daysInYear;
    effectiveDate = year.first;
  } else {
    const active = activeDaysIn(assignment, employment, monthStart, monthEnd);
    if (active === null) return null;
    raw =
      policy.accrualMethod === "monthly"
        ? (allowance / 12) * (active.days / month.daysInMonth)
        : (allowance * active.days) / daysInYear;
    effectiveDate = active.first;
  }

  const amount = Math.round(raw * fteRatio * 100) / 100;
  if (amount <= 0) return null;
  return { amount, sourceRef: `accrual:${policy.id}:${period}`, effectiveDate };
}
