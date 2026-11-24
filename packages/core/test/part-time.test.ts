import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  FULL_DAY_WEIGHT,
  fteRatioFromHours,
  weightedDays,
} from "../src/leave/part-time.js";
import {
  accrualTargetCents,
  type AccrualTargetInput,
} from "../src/leave/accrual-plan.js";
import { getDaysInYear } from "../src/leave/accrual.js";
import type { AccrualMethod } from "../src/leave/types.js";

// LEA-002 (#118): opt-in part-time proration per policy.

describe("fteRatioFromHours", () => {
  it("is 1 when the policy is not prorated (statutory vacation default)", () => {
    expect(fteRatioFromHours(20, null)).toBe(1);
  });

  it("divides by the agreement's full-time week, capped at 1", () => {
    expect(fteRatioFromHours(20, 40)).toBe(0.5);
    expect(fteRatioFromHours(30, 37.5)).toBe(0.8);
    expect(fteRatioFromHours(40, 40)).toBe(1);
    expect(fteRatioFromHours(45, 40)).toBe(1);
  });

  it("rejects hours that are not positive numbers", () => {
    expect(() => fteRatioFromHours(0, 40)).toThrow(RangeError);
    expect(() => fteRatioFromHours(Number.NaN, 40)).toThrow(RangeError);
    expect(() => fteRatioFromHours(20, 0)).toThrow(RangeError);
    expect(() => fteRatioFromHours(20, -1)).toThrow(RangeError);
  });

  it("property: always in (0, 1], and never decreases with more hours", () => {
    const hours = fc.integer({ min: 1, max: 16800 }).map((n) => n / 100);
    fc.assert(
      fc.property(hours, hours, hours, (a, b, full) => {
        const ra = fteRatioFromHours(a, full);
        expect(ra).toBeGreaterThan(0);
        expect(ra).toBeLessThanOrEqual(1);
        if (a <= b) expect(ra).toBeLessThanOrEqual(fteRatioFromHours(b, full));
      }),
    );
  });
});

describe("weightedDays", () => {
  it("weights each day by its range, clipped to the period", () => {
    expect(
      weightedDays(
        [
          { start: "2025-12-20", end: "2026-01-10", weight: FULL_DAY_WEIGHT },
          { start: "2026-01-21", end: "2026-02-28", weight: 500_000 },
        ],
        "2026-01-01",
        "2026-01-31",
      ),
    ).toBe(10 * FULL_DAY_WEIGHT + 11 * 500_000);
  });

  it("counts an overlapping day once, at the highest weight", () => {
    expect(
      weightedDays(
        [
          { start: "2026-03-01", end: "2026-03-10", weight: 500_000 },
          { start: "2026-03-06", end: "2026-03-15", weight: FULL_DAY_WEIGHT },
        ],
        "2026-03-01",
        "2026-03-31",
      ),
    ).toBe(5 * 500_000 + 10 * FULL_DAY_WEIGHT);
  });

  it("crosses a leap day", () => {
    expect(
      weightedDays(
        [{ start: "2028-02-28", end: "2028-03-01", weight: FULL_DAY_WEIGHT }],
        "2028-01-01",
        "2028-12-31",
      ),
    ).toBe(3 * FULL_DAY_WEIGHT);
  });
});

describe("part-time accrual", () => {
  const base = (
    method: AccrualMethod,
    allowance: number,
    employment: AccrualTargetInput["employment"],
    period: string,
  ): AccrualTargetInput => ({
    policy: { id: "p1", annualAllowanceDays: allowance, accrualMethod: method },
    assignments: [{ start: "2000-01-01", end: null }],
    employment,
    fteRatio: 1,
    period,
  });

  it("halves a full year at 20 of 40 hours", () => {
    const input = base(
      "monthly",
      22,
      [{ start: "2020-01-01", end: null, fteRatio: fteRatioFromHours(20, 40) }],
      "2026-12",
    );
    expect(accrualTargetCents(input)).toBe(1100);
  });

  it("weights each part of the year by its contract", () => {
    // 40h until 30 June, then 20h of a 40h week: (181 + 184 / 2) / 365.
    const input = base(
      "daily",
      30,
      [
        { start: "2020-01-01", end: "2026-06-30", fteRatio: 1 },
        { start: "2026-07-01", end: null, fteRatio: 0.5 },
      ],
      "2026-12",
    );
    expect(accrualTargetCents(input)).toBe(
      Math.round((3000 * (181 + 184 / 2)) / 365),
    );
  });

  it("rejects a span ratio outside (0, 1]", () => {
    expect(() =>
      accrualTargetCents(
        base(
          "monthly",
          22,
          [{ start: "2020-01-01", end: null, fteRatio: 1.2 }],
          "2026-01",
        ),
      ),
    ).toThrow(RangeError);
  });

  describe("properties", () => {
    const method = fc.constantFrom<AccrualMethod>(
      "upfront",
      "monthly",
      "daily",
    );
    const allowance = fc.integer({ min: 1, max: 9999 }).map((n) => n / 100);
    const year = fc.integer({ min: 2000, max: 2100 });
    const month = fc.integer({ min: 1, max: 12 });
    const ratio = fc.integer({ min: 1, max: 100 }).map((n) => n / 100);
    const dayOfYear = fc.integer({ min: 0, max: 364 });
    const dateIn = (y: number, offset: number) =>
      new Date(Date.UTC(y, 0, 1 + offset)).toISOString().slice(0, 10);
    const periodOf = (y: number, m: number) =>
      `${y}-${String(m).padStart(2, "0")}`;

    it("a NULL full-time week (no span ratio) leaves every amount unchanged", () => {
      fc.assert(
        fc.property(
          method,
          allowance,
          year,
          month,
          dayOfYear,
          (m, a, y, mo, s) => {
            const span = { start: dateIn(y, s), end: null };
            const plain = base(m, a, [span], periodOf(y, mo));
            const explicit = base(
              m,
              a,
              [{ ...span, fteRatio: fteRatioFromHours(37.5, null) }],
              periodOf(y, mo),
            );
            expect(accrualTargetCents(explicit)).toBe(
              accrualTargetCents(plain),
            );
          },
        ),
      );
    });

    it("a constant span ratio matches the same top-level FTE ratio over a year", () => {
      fc.assert(
        fc.property(method, allowance, year, ratio, (m, a, y, r) => {
          const bySpan = base(
            m,
            a,
            [{ start: "1990-01-01", end: null, fteRatio: r }],
            periodOf(y, 12),
          );
          const byTop = {
            ...base(
              m,
              a,
              [{ start: "1990-01-01", end: null }],
              periodOf(y, 12),
            ),
            fteRatio: r,
          };
          // The target is rounded once, to cents of a day, from a fraction
          // computed in floating point; on an exact half cent the two paths
          // may round apart, so they agree to the cent, not bit for bit.
          const exact = (Math.round(a * 100) * Math.round(r * 100)) / 100;
          expect(
            Math.abs(accrualTargetCents(bySpan) - accrualTargetCents(byTop)),
          ).toBeLessThanOrEqual(1);
          expect(
            Math.abs(accrualTargetCents(bySpan) - exact),
          ).toBeLessThanOrEqual(0.5);
        }),
      );
    });

    it("prorating never accrues more than full time, nor below zero", () => {
      fc.assert(
        fc.property(
          method,
          allowance,
          year,
          month,
          dayOfYear,
          ratio,
          (m, a, y, mo, s, r) => {
            const span = { start: dateIn(y, s), end: null };
            const full = accrualTargetCents(
              base(m, a, [span], periodOf(y, mo)),
            );
            const part = accrualTargetCents(
              base(m, a, [{ ...span, fteRatio: r }], periodOf(y, mo)),
            );
            expect(part).toBeGreaterThanOrEqual(0);
            expect(part).toBeLessThanOrEqual(full);
          },
        ),
      );
    });

    it("rounds an exact half cent up, whatever the float error (CI seed -1285587461)", () => {
      // 14.5 days at 3%: exactly 43.5 cents for 2029, so half-up gives 44.
      const input = base(
        "daily",
        14.5,
        [{ start: "1990-01-01", end: null, fteRatio: 0.03 }],
        periodOf(2029, 12),
      );
      expect(accrualTargetCents(input)).toBe(44);
    });

    it("daily: a mid-year change of contract weights each day", () => {
      fc.assert(
        fc.property(
          allowance,
          year,
          dayOfYear,
          ratio,
          ratio,
          (a, y, s, r1, r2) => {
            const split = dateIn(y, s);
            const dayBefore = new Date(Date.parse(split) - 86_400_000)
              .toISOString()
              .slice(0, 10);
            const input = base(
              "daily",
              a,
              [
                { start: "1990-01-01", end: dayBefore, fteRatio: r1 },
                { start: split, end: null, fteRatio: r2 },
              ],
              periodOf(y, 12),
            );
            const days = getDaysInYear(y);
            const ppm = (r: number) => Math.round(r * FULL_DAY_WEIGHT);
            const weighted = s * ppm(r1) + (days - s) * ppm(r2);
            // Exact half-up rounding of a·100·weighted / (FULL_DAY_WEIGHT·days).
            const num = BigInt(Math.round(a * 100)) * BigInt(weighted);
            const den = BigInt(FULL_DAY_WEIGHT) * BigInt(days);
            expect(accrualTargetCents(input)).toBe(
              Number((2n * num + den) / (2n * den)),
            );
          },
        ),
      );
    });
  });
});
