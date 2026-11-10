import { isBeforeDate } from "../calendar/business-date.js";

/**
 * A span of local calendar days during which a person was employed
 * (`YYYY-MM-DD`, both ends inclusive); `end` is null while it is open.
 */
export interface EmploymentPeriod {
  start: string;
  end: string | null;
}

/**
 * Whether `date` falls inside any of the employment periods. `null` periods
 * mean "unknown" (no employment records, legacy data): the person counts as
 * employed every day, so nothing changes for them.
 *
 * @example
 * isEmployedOn([{ start: "2026-11-04", end: null }], "2026-11-03"); // => false
 * isEmployedOn([{ start: "2026-11-04", end: null }], "2026-11-04"); // => true
 * isEmployedOn(null, "2026-11-03"); // => true
 */
export function isEmployedOn(
  periods: readonly EmploymentPeriod[] | null,
  date: string,
): boolean {
  if (periods === null) return true;
  return periods.some(
    (period) =>
      !isBeforeDate(date, period.start) &&
      (period.end === null || !isBeforeDate(period.end, date)),
  );
}
