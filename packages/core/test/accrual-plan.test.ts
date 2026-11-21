import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  accrualPeriodOf,
  planAccrual,
  type AccrualPlanInput,
} from "../src/leave/accrual-plan.js";
import { calculateProratedAllowance } from "../src/leave/accrual.js";
import type { AccrualMethod } from "../src/leave/types.js";

const MONTHS = Array.from(
  { length: 12 },
  (_, i) => `${String(i + 1).padStart(2, "0")}`,
);

function input(
  overrides: Partial<Omit<AccrualPlanInput, "policy">> & {
    method?: AccrualMethod;
    allowance?: number;
  } = {},
): AccrualPlanInput {
  return {
    policy: {
      id: "p1",
      annualAllowanceDays: overrides.allowance ?? 24,
      accrualMethod: overrides.method ?? "monthly",
    },
    assignment: overrides.assignment ?? { start: "2020-01-01", end: null },
    employment: overrides.employment ?? [{ start: "2020-01-01", end: null }],
    fteRatio: overrides.fteRatio ?? 1,
    period: overrides.period ?? "2026-05",
  };
}

const yearTotal = (base: Omit<AccrualPlanInput, "period">, year: number) =>
  MONTHS.reduce(
    (sum, m) =>
      sum + (planAccrual({ ...base, period: `${year}-${m}` })?.amount ?? 0),
    0,
  );

describe("planAccrual (LEA-002)", () => {
  it("monthly: allowance / 12 for a full month, with a deterministic sourceRef", () => {
    expect(planAccrual(input())).toEqual({
      amount: 2,
      sourceRef: "accrual:p1:2026-05",
      effectiveDate: "2026-05-01",
    });
  });

  it("monthly: prorates a mid-month start and a mid-month termination", () => {
    // 16 of 31 March days: 2 × 16/31 = 1.032...
    expect(
      planAccrual(
        input({
          employment: [{ start: "2026-03-16", end: null }],
          period: "2026-03",
        }),
      ),
    ).toMatchObject({ amount: 1.03, effectiveDate: "2026-03-16" });
    // 10 of 30 June days.
    expect(
      planAccrual(
        input({
          employment: [{ start: "2020-01-01", end: "2026-06-10" }],
          period: "2026-06",
        }),
      )?.amount,
    ).toBe(0.67);
    expect(
      planAccrual(
        input({
          employment: [{ start: "2020-01-01", end: "2026-06-10" }],
          period: "2026-07",
        }),
      ),
    ).toBeNull();
  });

  it("monthly: skips months before the assignment and before the hire date", () => {
    expect(
      planAccrual(input({ assignment: { start: "2026-06-01", end: null } })),
    ).toBeNull();
    expect(
      planAccrual(input({ employment: [{ start: "2026-06-01", end: null }] })),
    ).toBeNull();
  });

  it("daily: active days / days in the year, leap years included", () => {
    // February 2028 (leap): 24 × 29 / 366.
    expect(
      planAccrual(input({ method: "daily", period: "2028-02" }))?.amount,
    ).toBe(1.9);
    // February 2026: 24 × 28 / 365.
    expect(
      planAccrual(input({ method: "daily", period: "2026-02" }))?.amount,
    ).toBe(1.84);
  });

  it("upfront: the prorated year in the first active month only", () => {
    const full = input({ method: "upfront", period: "2026-01" });
    expect(planAccrual(full)?.amount).toBe(24);
    expect(planAccrual({ ...full, period: "2026-02" })).toBeNull();

    // Joins 1 July 2026: 184 / 365 of the year, granted in July.
    const joiner = input({
      method: "upfront",
      employment: [{ start: "2026-07-01", end: null }],
    });
    expect(planAccrual({ ...joiner, period: "2026-01" })).toBeNull();
    expect(planAccrual({ ...joiner, period: "2026-07" })).toMatchObject({
      amount: 12.1,
      effectiveDate: "2026-07-01",
    });
  });

  it("crosses December/January: each year is accrued on its own", () => {
    const base = input({
      method: "upfront",
      employment: [{ start: "2026-12-01", end: null }],
    });
    // 31 / 365 of 2026 in December, the full 2027 allowance in January.
    expect(planAccrual({ ...base, period: "2026-12" })?.amount).toBe(2.04);
    expect(planAccrual({ ...base, period: "2027-01" })).toMatchObject({
      amount: 24,
      sourceRef: "accrual:p1:2027-01",
      effectiveDate: "2027-01-01",
    });
  });

  it("applies the FTE ratio for part-time contracts", () => {
    expect(planAccrual(input({ fteRatio: 0.5 }))?.amount).toBe(1);
    expect(
      planAccrual(
        input({ method: "upfront", fteRatio: 0.5, period: "2026-01" }),
      )?.amount,
    ).toBe(12);
  });

  it("stops the assignment at the day before the next one", () => {
    // Policy replaced on 16 May: this one accrues 15 of 31 days.
    expect(
      planAccrual(
        input({ assignment: { start: "2026-01-01", end: "2026-05-15" } }),
      )?.amount,
    ).toBe(0.97);
  });

  it("does not count overlapping employment rows twice", () => {
    expect(
      planAccrual(
        input({
          employment: [
            { start: "2020-01-01", end: "2026-05-20" },
            { start: "2026-05-10", end: null },
          ],
        }),
      )?.amount,
    ).toBe(2);
  });

  it("plans nothing for a zero allowance", () => {
    for (const method of ["upfront", "monthly", "daily"] as const) {
      expect(
        planAccrual(input({ method, allowance: 0, period: "2026-01" })),
      ).toBeNull();
    }
  });

  it("rejects malformed periods and FTE ratios", () => {
    expect(() => planAccrual(input({ period: "2026-13" }))).toThrow(RangeError);
    expect(() => planAccrual(input({ fteRatio: 0 }))).toThrow(RangeError);
    expect(() => planAccrual(input({ fteRatio: 1.5 }))).toThrow(RangeError);
  });

  it("derives the month bounds of a run date, leap February included", () => {
    expect(accrualPeriodOf("2028-02-10")).toEqual({
      period: "2028-02",
      monthStart: "2028-02-01",
      monthEnd: "2028-02-29",
      yearStart: "2028-01-01",
      yearEnd: "2028-12-31",
    });
  });

  describe("properties", () => {
    const allowance = fc.integer({ min: 1, max: 4000 }).map((n) => n / 100);
    const fte = fc.integer({ min: 1, max: 100 }).map((n) => n / 100);
    const year = fc.integer({ min: 2000, max: 2100 });
    const dayOfYear = fc.integer({ min: 0, max: 365 });
    const method = fc.constantFrom<AccrualMethod>(
      "upfront",
      "monthly",
      "daily",
    );
    const dateIn = (y: number, offset: number) => {
      const d = new Date(Date.UTC(y, 0, 1 + offset));
      return d.getUTCFullYear() === y
        ? d.toISOString().slice(0, 10)
        : `${y}-12-31`;
    };

    it("12 monthly accruals of a full year add up to the allowance within rounding", () => {
      fc.assert(
        fc.property(allowance, fte, year, (a, f, y) => {
          const total = yearTotal(
            {
              policy: {
                id: "p",
                annualAllowanceDays: a,
                accrualMethod: "monthly",
              },
              assignment: { start: `${y - 1}-01-01`, end: null },
              employment: [{ start: `${y - 1}-06-01`, end: null }],
              fteRatio: f,
            },
            y,
          );
          expect(Math.abs(total - a * f)).toBeLessThanOrEqual(
            12 * 0.005 + 1e-9,
          );
        }),
      );
    });

    it("daily accruals over a year equal the upfront prorated allowance within rounding", () => {
      fc.assert(
        fc.property(
          allowance,
          fte,
          year,
          dayOfYear,
          dayOfYear,
          (a, f, y, s, e) => {
            const span = {
              start: dateIn(y, Math.min(s, e)),
              end: dateIn(y, Math.max(s, e)),
            };
            const base = {
              assignment: { start: `${y}-01-01`, end: null },
              employment: [span],
              fteRatio: f,
            };
            const daily = yearTotal(
              {
                ...base,
                policy: {
                  id: "p",
                  annualAllowanceDays: a,
                  accrualMethod: "daily",
                },
              },
              y,
            );
            const upfront = yearTotal(
              {
                ...base,
                policy: {
                  id: "p",
                  annualAllowanceDays: a,
                  accrualMethod: "upfront",
                },
              },
              y,
            );
            const prorated = calculateProratedAllowance({
              annualAllowance: a,
              year: y,
              startDate: span.start,
              endDate: span.end,
              fteRatio: f,
            });
            // Upfront is the prorated year, granted once.
            expect(upfront).toBeCloseTo(prorated, 9);
            expect(Math.abs(daily - prorated)).toBeLessThanOrEqual(
              13 * 0.005 + 1e-9,
            );
          },
        ),
      );
    });

    it("never plans a negative or zero amount, and re-planning is identical", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 4000 }).map((n) => n / 100),
          fte,
          method,
          year,
          dayOfYear,
          fc.integer({ min: 1, max: 12 }),
          (a, f, m, y, s, month) => {
            const plan: AccrualPlanInput = {
              policy: { id: "p", annualAllowanceDays: a, accrualMethod: m },
              assignment: { start: `${y}-01-01`, end: null },
              employment: [{ start: dateIn(y, s), end: null }],
              fteRatio: f,
              period: `${y}-${String(month).padStart(2, "0")}`,
            };
            const first = planAccrual(plan);
            if (first !== null) expect(first.amount).toBeGreaterThan(0);
            expect(planAccrual(plan)).toEqual(first);
          },
        ),
      );
    });
  });
});
