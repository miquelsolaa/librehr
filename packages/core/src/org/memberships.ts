import { Temporal } from "temporal-polyfill";

/**
 * ORG-007 (issue #81, ADR 0008): secondary memberships of an employee in
 * departments, projects and areas. Validity periods are calendar dates
 * (`YYYY-MM-DD`) in the organization's time zone; both ends are included and
 * a null end date is open-ended. The primary department is not a membership.
 */
export interface MembershipPeriod {
  startDate: string;
  endDate: string | null;
}

/** Exactly one of departmentId and groupId is set on a stored membership. */
export interface MembershipTargetRef {
  departmentId: string | null;
  groupId: string | null;
}

export interface EmployeeMembership
  extends MembershipPeriod, MembershipTargetRef {
  /** Optional share of the person's time, in (0, 100]. */
  allocationPercent: number | null;
}

/** Inclusive calendar-date range. */
export interface MembershipDateRange {
  startDate: string;
  endDate: string;
}

/** Allocation above which a warning is raised (never a block, ADR 0008 D3). */
export const FULL_ALLOCATION_PERCENT = 100;

function compareDates(a: string, b: string): number {
  return Temporal.PlainDate.compare(
    Temporal.PlainDate.from(a),
    Temporal.PlainDate.from(b),
  );
}

/** Whether a period ends before `date`; an open-ended period never does. */
function endsBefore(endDate: string | null, date: string): boolean {
  return endDate !== null && compareDates(endDate, date) < 0;
}

/**
 * Whether a membership is active on a calendar date (both ends included).
 *
 * @example
 * isMembershipActiveOn({ startDate: "2026-01-01", endDate: "2026-12-31" }, "2026-12-31"); // => true
 * isMembershipActiveOn({ startDate: "2026-01-01", endDate: null }, "2099-01-01"); // => true
 */
export function isMembershipActiveOn(
  period: MembershipPeriod,
  date: string,
): boolean {
  return (
    compareDates(period.startDate, date) <= 0 &&
    !endsBefore(period.endDate, date)
  );
}

/**
 * Whether a membership is active on at least one day of a date range, e.g.
 * an absence shown in a group's calendar.
 *
 * @example
 * isMembershipActiveDuring(
 *   { startDate: "2026-03-01", endDate: "2026-03-31" },
 *   { startDate: "2026-02-25", endDate: "2026-03-01" },
 * ); // => true
 */
export function isMembershipActiveDuring(
  period: MembershipPeriod,
  range: MembershipDateRange,
): boolean {
  return (
    compareDates(period.startDate, range.endDate) <= 0 &&
    !endsBefore(period.endDate, range.startDate)
  );
}

/**
 * Whether two validity periods share at least one day. Mirrors the
 * exclusion constraints of migration 0046 (`daterange(..., '[]') &&`).
 *
 * @example
 * membershipPeriodsOverlap(
 *   { startDate: "2026-01-01", endDate: "2026-06-30" },
 *   { startDate: "2026-07-01", endDate: null },
 * ); // => false
 */
export function membershipPeriodsOverlap(
  a: MembershipPeriod,
  b: MembershipPeriod,
): boolean {
  return (
    !endsBefore(a.endDate, b.startDate) && !endsBefore(b.endDate, a.startDate)
  );
}

/** Whether two memberships point at the same department or group. */
export function isSameMembershipTarget(
  a: MembershipTargetRef,
  b: MembershipTargetRef,
): boolean {
  if (a.departmentId !== null) return a.departmentId === b.departmentId;
  return a.groupId !== null && a.groupId === b.groupId;
}

/**
 * The first existing membership with the same target whose period overlaps
 * the candidate's, or null. Lets the API answer 409 before the database's
 * exclusion constraint fires.
 *
 * @example
 * findOverlappingMembership(
 *   [{ departmentId: "d1", groupId: null, startDate: "2026-01-01", endDate: null }],
 *   { departmentId: "d1", groupId: null, startDate: "2026-05-01", endDate: null },
 * ); // => the existing row
 */
export function findOverlappingMembership<
  T extends MembershipPeriod & MembershipTargetRef,
>(
  existing: readonly T[],
  candidate: MembershipPeriod & MembershipTargetRef,
): T | null {
  return (
    existing.find(
      (m) =>
        isSameMembershipTarget(m, candidate) &&
        membershipPeriodsOverlap(m, candidate),
    ) ?? null
  );
}

/** Memberships active on a calendar date, in their original order. */
export function activeMembershipsOn<T extends MembershipPeriod>(
  memberships: readonly T[],
  date: string,
): T[] {
  return memberships.filter((m) => isMembershipActiveOn(m, date));
}

export interface AllocationCheck {
  /** Sum of the allocations of the memberships active on the date. */
  totalPercent: number;
  /** True when the total is above 100%: a warning, never a block. */
  overAllocated: boolean;
}

/**
 * Total allocation of the secondary memberships active on a date. Rows
 * without an allocation are not counted (allocation is optional).
 *
 * @example
 * allocationOn(
 *   [
 *     { departmentId: "d1", groupId: null, allocationPercent: 60, startDate: "2026-01-01", endDate: null },
 *     { departmentId: null, groupId: "g1", allocationPercent: 50, startDate: "2026-01-01", endDate: null },
 *   ],
 *   "2026-02-01",
 * ); // => { totalPercent: 110, overAllocated: true }
 */
export function allocationOn(
  memberships: readonly EmployeeMembership[],
  date: string,
): AllocationCheck {
  // Sum in hundredths: allocation is numeric(5,2), so this is exact.
  const hundredths = activeMembershipsOn(memberships, date).reduce(
    (sum, m) => sum + Math.round((m.allocationPercent ?? 0) * 100),
    0,
  );
  const totalPercent = hundredths / 100;
  return {
    totalPercent,
    overAllocated: totalPercent > FULL_ALLOCATION_PERCENT,
  };
}

export interface AllocationPeak extends AllocationCheck {
  /** First date of the period on which the total reaches its peak. */
  date: string;
}

/**
 * Highest total allocation on any day of a period, so a write can warn when
 * a new or changed membership pushes some day above 100%. Totals only rise
 * on a start date, so the peak is on the period's start or on a start date
 * inside it.
 *
 * @example
 * peakAllocationDuring(
 *   [
 *     { departmentId: "d1", groupId: null, allocationPercent: 60, startDate: "2026-01-01", endDate: null },
 *     { departmentId: null, groupId: "g1", allocationPercent: 50, startDate: "2026-03-01", endDate: null },
 *   ],
 *   { startDate: "2026-01-01", endDate: null },
 * ); // => { date: "2026-03-01", totalPercent: 110, overAllocated: true }
 */
export function peakAllocationDuring(
  memberships: readonly EmployeeMembership[],
  period: MembershipPeriod,
): AllocationPeak {
  const candidates = [
    period.startDate,
    ...memberships
      .map((m) => m.startDate)
      .filter((d) => isMembershipActiveOn(period, d)),
  ].sort(compareDates);
  let peak: AllocationPeak = {
    date: period.startDate,
    ...allocationOn(memberships, period.startDate),
  };
  for (const date of candidates) {
    const check = allocationOn(memberships, date);
    if (check.totalPercent > peak.totalPercent) peak = { date, ...check };
  }
  return peak;
}
