import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  accrualPeriodOf,
  accrualSourceRefPrefix,
  accrualTargetCents,
  planAccrual,
  type AccrualTargetInput,
} from "../src/leave/accrual-plan.js";
import { getDaysInYear } from "../src/leave/accrual.js";
import type { AccrualMethod } from "../src/leave/types.js";

type Base = Omit<AccrualTargetInput, "period">;

function base(
  overrides: Partial<Base> & {
    method?: AccrualMethod;
    allowance?: number;
  } = {},
): Base {
  return {
    policy: {
      id: "p1",
      annualAllowanceDays: overrides.allowance ?? 24,
      accrualMethod: overrides.method ?? "monthly",
    },
    assignments: overrides.assignments ?? [{ start: "1990-01-01", end: null }],
    employment: overrides.employment ?? [{ start: "1990-01-01", end: null }],
    fteRatio: overrides.fteRatio ?? 1,
  };
}

/** Runs the given months of a year against an in-memory ledger. */
function runMonths(b: Base, year: number, months: readonly number[]) {
  const entries = new Map<string, number>(); // sourceRef -> cents
  for (const m of months) {
    const period = `${year}-${String(m).padStart(2, "0")}`;
    const accruedCents = [...entries.values()].reduce((s, c) => s + c, 0);
    const plan = planAccrual({ ...b, period, accruedCents });
    if (plan.status === "accrue" && !entries.has(plan.sourceRef)) {
      expect(plan.amount).toBeGreaterThan(0);
      entries.set(plan.sourceRef, Math.round(plan.amount * 100));
    }
  }
  return entries;
}

const ALL_MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const totalCents = (entries: Map<string, number>) =>
  [...entries.values()].reduce((s, c) => s + c, 0);

describe("planAccrual (LEA-002)", () => {
  it("monthly: plans this month's share with a deterministic sourceRef", () => {
    expect(
      planAccrual({ ...base(), period: "2026-05", accruedCents: 800 }),
    ).toEqual({
      status: "accrue",
      amount: 2,
      sourceRef: "accrual:p1:2026-05",
      effectiveDate: "2026-05-01",
    });
    expect(
      planAccrual({ ...base(), period: "2026-05", accruedCents: 1000 }),
    ).toEqual({ status: "up_to_date" });
  });

  it("monthly: a 22-day allowance adds up to exactly 22.00 over the year", () => {
    const entries = runMonths(base({ allowance: 22 }), 2026, ALL_MONTHS);
    expect(totalCents(entries)).toBe(2200);
    expect(entries.size).toBe(12);
  });

  it("monthly: prorates a mid-month start and a mid-month termination", () => {
    // 16 of 31 March days: 2 × 16/31.
    expect(
      planAccrual({
        ...base({ employment: [{ start: "2026-03-16", end: null }] }),
        period: "2026-03",
        accruedCents: 0,
      }),
    ).toMatchObject({ amount: 1.03, effectiveDate: "2026-03-16" });
    // Left 10 June: 5 full months + 10/30 of June = 10.67 for the year.
    const leaver = base({
      employment: [{ start: "2020-01-01", end: "2026-06-10" }],
    });
    expect(totalCents(runMonths(leaver, 2026, ALL_MONTHS))).toBe(1067);
  });

  it("catches up a missed month on the next run, dated in the run's month", () => {
    const entries = runMonths(base(), 2026, [1, 3]);
    expect([...entries]).toEqual([
      ["accrual:p1:2026-01", 200],
      ["accrual:p1:2026-03", 400],
    ]);
  });

  it("dates a catch-up after the employee left on their last day", () => {
    const leaver = base({
      employment: [{ start: "2020-01-01", end: "2026-02-15" }],
    });
    expect(
      planAccrual({ ...leaver, period: "2026-03", accruedCents: 200 }),
    ).toMatchObject({ status: "accrue", effectiveDate: "2026-02-15" });
  });

  it("reports over-accrual instead of planning a negative entry", () => {
    const leaver = base({
      employment: [{ start: "2020-01-01", end: "2026-01-31" }],
    });
    expect(
      planAccrual({ ...leaver, period: "2026-03", accruedCents: 600 }),
    ).toEqual({
      status: "over_accrued",
      excessCents: 400,
    });
  });

  it("daily: active days / days in the year, leap years included", () => {
    // Jan + leap Feb 2028: 24 × 60 / 366 = 3.93.
    expect(
      accrualTargetCents({ ...base({ method: "daily" }), period: "2028-02" }),
    ).toBe(393);
    expect(
      totalCents(
        runMonths(base({ method: "daily", allowance: 22 }), 2028, ALL_MONTHS),
      ),
    ).toBe(2200);
  });

  it("upfront: grants the prorated year once, from the first active month on", () => {
    const full = runMonths(base({ method: "upfront" }), 2026, ALL_MONTHS);
    expect([...full]).toEqual([["accrual:p1:2026-01", 2400]]);

    // Joins 1 July 2026: 184 / 365 of the year, granted in July.
    const joiner = base({
      method: "upfront",
      employment: [{ start: "2026-07-01", end: null }],
    });
    expect([...runMonths(joiner, 2026, ALL_MONTHS)]).toEqual([
      ["accrual:p1:2026-07", 1210],
    ]);
  });

  it("upfront: a backdated hire is granted on the next run", () => {
    const hire = base({
      method: "upfront",
      employment: [{ start: "2026-01-15", end: null }],
    });
    expect(
      planAccrual({ ...hire, period: "2026-03", accruedCents: 0 }),
    ).toMatchObject({
      status: "accrue",
      sourceRef: "accrual:p1:2026-03",
      effectiveDate: "2026-03-01",
    });
  });

  it("does not double count when a policy switches from monthly to upfront", () => {
    const monthly = runMonths(base(), 2026, [1, 2, 3]);
    const accruedCents = totalCents(monthly);
    const plan = planAccrual({
      ...base({ method: "upfront" }),
      period: "2026-04",
      accruedCents,
    });
    expect(plan).toMatchObject({ status: "accrue", amount: 18 });
  });

  it("crosses December/January: each year is accrued on its own", () => {
    const b = base({
      method: "upfront",
      employment: [{ start: "2026-12-01", end: null }],
    });
    // 31 / 365 of 2026 in December, the full 2027 allowance in January.
    expect(accrualTargetCents({ ...b, period: "2026-12" })).toBe(204);
    expect(
      planAccrual({ ...b, period: "2027-01", accruedCents: 0 }),
    ).toMatchObject({
      amount: 24,
      sourceRef: "accrual:p1:2027-01",
    });
    expect(accrualSourceRefPrefix("p1", 2027)).toBe("accrual:p1:2027-");
  });

  it("applies the FTE ratio for part-time contracts", () => {
    expect(
      totalCents(runMonths(base({ fteRatio: 0.5 }), 2026, ALL_MONTHS)),
    ).toBe(1200);
  });

  it("sums every window of the policy, never counting a day twice", () => {
    // Replaced on 10 March, assigned again from 20 March: 21 of 31 March days.
    const b = base({
      assignments: [
        { start: "2026-01-01", end: "2026-03-09" },
        { start: "2026-03-20", end: null },
      ],
      employment: [
        { start: "2020-01-01", end: "2026-03-25" },
        { start: "2026-03-20", end: null },
      ],
    });
    expect(
      planAccrual({ ...b, period: "2026-03", accruedCents: 400 }),
    ).toMatchObject({
      amount: 1.35,
      effectiveDate: "2026-03-01",
    });
  });

  it("ignores an empty window left by a same-day replacement", () => {
    const b = base({
      assignments: [{ start: "2026-03-01", end: "2026-02-28" }],
    });
    expect(accrualTargetCents({ ...b, period: "2026-12" })).toBe(0);
  });

  it("plans nothing for a zero allowance", () => {
    for (const method of ["upfront", "monthly", "daily"] as const) {
      expect(
        planAccrual({
          ...base({ method, allowance: 0 }),
          period: "2026-12",
          accruedCents: 0,
        }),
      ).toEqual({ status: "up_to_date" });
    }
  });

  it("rejects malformed periods and FTE ratios", () => {
    expect(() => accrualTargetCents({ ...base(), period: "2026-13" })).toThrow(
      RangeError,
    );
    expect(() =>
      accrualTargetCents({ ...base({ fteRatio: 0 }), period: "2026-01" }),
    ).toThrow(RangeError);
    expect(() =>
      accrualTargetCents({ ...base({ fteRatio: 1.5 }), period: "2026-01" }),
    ).toThrow(RangeError);
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
    const allowanceCents = fc.integer({ min: 1, max: 9999 });
    const fte = fc.integer({ min: 1, max: 100 }).map((n) => n / 100);
    const year = fc.integer({ min: 2000, max: 2100 });
    const dayOfYear = fc.integer({ min: 0, max: 365 });
    const method = fc.constantFrom<AccrualMethod>(
      "upfront",
      "monthly",
      "daily",
    );
    const months = fc
      .subarray(ALL_MONTHS, { minLength: 1 })
      .map((ms) => (ms.includes(12) ? ms : [...ms, 12]));
    const dateIn = (y: number, offset: number) => {
      const d = new Date(Date.UTC(y, 0, 1 + offset));
      return d.getUTCFullYear() === y
        ? d.toISOString().slice(0, 10)
        : `${y}-12-31`;
    };
    const days = (start: string, end: string) =>
      (Date.parse(end) - Date.parse(start)) / 86_400_000 + 1;

    it("a full year adds up exactly to the allowance, whatever months ran", () => {
      fc.assert(
        fc.property(
          allowanceCents,
          fte,
          method,
          year,
          months,
          (a, f, m, y, ran) => {
            const b = base({ method: m, allowance: a / 100, fteRatio: f });
            expect(totalCents(runMonths(b, y, ran))).toBe(
              Math.round(a * 1 * f),
            );
          },
        ),
      );
    });

    it("a partial year adds up exactly to the prorated allowance", () => {
      fc.assert(
        fc.property(
          allowanceCents,
          fte,
          fc.constantFrom<AccrualMethod>("upfront", "daily"),
          year,
          dayOfYear,
          dayOfYear,
          (a, f, m, y, s, e) => {
            const span = {
              start: dateIn(y, Math.min(s, e)),
              end: dateIn(y, Math.max(s, e)),
            };
            const b = base({
              method: m,
              allowance: a / 100,
              fteRatio: f,
              employment: [span],
            });
            const expected = Math.round(
              a * (days(span.start, span.end) / getDaysInYear(y)) * f,
            );
            expect(totalCents(runMonths(b, y, ALL_MONTHS))).toBe(expected);
          },
        ),
      );
    });

    it("never plans a negative entry, and re-planning is identical", () => {
      fc.assert(
        fc.property(
          allowanceCents,
          fte,
          method,
          year,
          dayOfYear,
          fc.integer({ min: 1, max: 12 }),
          fc.integer({ min: 0, max: 9999 }),
          (a, f, m, y, s, month, accrued) => {
            const input = {
              ...base({
                method: m,
                allowance: a / 100,
                fteRatio: f,
                employment: [{ start: dateIn(y, s), end: null }],
              }),
              period: `${y}-${String(month).padStart(2, "0")}`,
              accruedCents: accrued,
            };
            const plan = planAccrual(input);
            if (plan.status === "accrue")
              expect(plan.amount).toBeGreaterThan(0);
            expect(planAccrual(input)).toEqual(plan);
          },
        ),
      );
    });
  });
});
