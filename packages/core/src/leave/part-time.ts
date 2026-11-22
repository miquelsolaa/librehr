import { Temporal } from "temporal-polyfill";

/**
 * Part-time proration of leave accrual (LEA-002, issue #118).
 *
 * A ratio is kept in parts per million so weighted day counts stay integers:
 * a day at ratio 1 weighs exactly 1 000 000, so an unprorated policy gives
 * exactly the same day counts, and therefore the same amounts, as before.
 */
export const FULL_DAY_WEIGHT = 1_000_000;

/**
 * Full-time-equivalent ratio of a contract for a policy (LEA-002).
 *
 * - `fullTimeHoursPerWeek` null: the policy is not prorated, ratio 1. This
 *   is the default and what statutory vacation requires in Spain, where
 *   part-time staff get the same days (ET art. 12.4.d).
 * - Otherwise `hoursPerWeek / fullTimeHoursPerWeek`, capped at 1: a contract
 *   longer than the agreement's full-time week never accrues more.
 *
 * @throws RangeError when an hour figure is not a positive finite number.
 *
 * @example
 * fteRatioFromHours(20, 40); // => 0.5
 * fteRatioFromHours(45, 40); // => 1
 * fteRatioFromHours(20, null); // => 1
 */
export function fteRatioFromHours(
  hoursPerWeek: number,
  fullTimeHoursPerWeek: number | null,
): number {
  if (fullTimeHoursPerWeek === null) return 1;
  if (!(Number.isFinite(fullTimeHoursPerWeek) && fullTimeHoursPerWeek > 0)) {
    throw new RangeError("fullTimeHoursPerWeek must be a positive number");
  }
  if (!(Number.isFinite(hoursPerWeek) && hoursPerWeek > 0)) {
    throw new RangeError("hoursPerWeek must be a positive number");
  }
  return Math.min(1, hoursPerWeek / fullTimeHoursPerWeek);
}

/** An inclusive range of local dates with a weight per day. */
export interface WeightedRange {
  start: string;
  end: string;
  /** Weight of each day, in parts per million (1 000 000 = full day). */
  weight: number;
}

const EPOCH = Temporal.PlainDate.from("1970-01-01");
const dayNumber = (d: string) => EPOCH.until(Temporal.PlainDate.from(d)).days;

/**
 * Sum of the day weights of `ranges` within [from, to] (inclusive local
 * dates), in parts per million of a day. Where ranges overlap, a day counts
 * once, at the highest weight: two employment rows covering the same day
 * never add up to more than one day.
 *
 * @example
 * weightedDays(
 *   [{ start: "2026-01-01", end: "2026-01-10", weight: 500_000 }],
 *   "2026-01-01",
 *   "2026-01-31",
 * ); // => 5_000_000 (five full days' worth)
 */
export function weightedDays(
  ranges: readonly WeightedRange[],
  from: string,
  to: string,
): number {
  const lo = dayNumber(from);
  const hi = dayNumber(to);
  const segments = ranges
    .map((r) => ({
      start: Math.max(dayNumber(r.start), lo),
      end: Math.min(dayNumber(r.end), hi),
      weight: r.weight,
    }))
    .filter((r) => r.start <= r.end);
  if (segments.length === 0) return 0;

  // Elementary intervals between every boundary; each takes the highest
  // weight of the segments covering it.
  const bounds = [
    ...new Set(segments.flatMap((s) => [s.start, s.end + 1])),
  ].sort((a, b) => a - b);
  let total = 0;
  for (let i = 0; i < bounds.length - 1; i++) {
    const start = bounds[i]!;
    const next = bounds[i + 1]!;
    let weight = 0;
    for (const s of segments) {
      if (s.start <= start && s.end >= start)
        weight = Math.max(weight, s.weight);
    }
    total += weight * (next - start);
  }
  return total;
}
