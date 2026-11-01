import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  calculateProratedAllowance,
  calculatePeriodicAccrual,
  isLeapYear,
  getDaysInYear,
} from "../src/leave/accrual.js";

describe("Leave Accrual & Prorating (LEA-002)", () => {
  it("computes full allowance for an employee active the entire year", () => {
    const allowance = calculateProratedAllowance({
      annualAllowance: 22,
      year: 2026,
      startDate: "2025-01-01",
      fteRatio: 1.0,
    });
    expect(allowance).toBe(22);
  });

  it("prorates allowance for an employee starting mid-year on July 1", () => {
    // 2026 is non-leap (365 days). July 1 to Dec 31 = 184 days.
    // 22 * (184 / 365) = 11.0904...
    const allowance = calculateProratedAllowance({
      annualAllowance: 22,
      year: 2026,
      startDate: "2026-07-01",
      fteRatio: 1.0,
      roundingPrecision: "exact",
    });
    expect(allowance).toBe(11.09);

    const roundedHalf = calculateProratedAllowance({
      annualAllowance: 22,
      year: 2026,
      startDate: "2026-07-01",
      fteRatio: 1.0,
      roundingPrecision: "half_day",
    });
    expect(roundedHalf).toBe(11);
  });

  it("prorates allowance for part-time (0.5 FTE) employee", () => {
    const allowance = calculateProratedAllowance({
      annualAllowance: 22,
      year: 2026,
      startDate: "2026-01-01",
      fteRatio: 0.5,
    });
    expect(allowance).toBe(11);
  });

  it("correctly handles leap years and contract terminations", () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2026)).toBe(false);
    expect(getDaysInYear(2024)).toBe(366);
    expect(getDaysInYear(2026)).toBe(365);

    // Contract terminated on June 30, 2026 (Jan 1 to Jun 30 = 181 days)
    // 22 * (181 / 365) = 10.91
    const allowance = calculateProratedAllowance({
      annualAllowance: 22,
      year: 2026,
      startDate: "2025-01-01",
      endDate: "2026-06-30",
    });
    expect(allowance).toBe(10.91);
  });

  it("calculates periodic accrual for upfront and monthly methods", () => {
    const upfrontMonth1 = calculatePeriodicAccrual({
      annualAllowance: 24,
      accrualMethod: "upfront",
      month: 1,
    });
    expect(upfrontMonth1).toBe(24);

    const upfrontMonth2 = calculatePeriodicAccrual({
      annualAllowance: 24,
      accrualMethod: "upfront",
      month: 2,
    });
    expect(upfrontMonth2).toBe(0);

    const monthly = calculatePeriodicAccrual({
      annualAllowance: 24,
      accrualMethod: "monthly",
      month: 5,
    });
    expect(monthly).toBe(2);
  });

  // Property-based test
  it("satisfies property: prorated allowance is always within [0, annualAllowance * fteRatio]", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 40 }), // annualAllowance
        fc.float({ min: Math.fround(0.1), max: Math.fround(1.0), noNaN: true }), // fteRatio
        fc.integer({ min: 1, max: 12 }), // start month
        fc.integer({ min: 1, max: 28 }), // start day
        (allowance, fte, month, day) => {
          const monthStr = String(month).padStart(2, "0");
          const dayStr = String(day).padStart(2, "0");
          const startDate = `2026-${monthStr}-${dayStr}`;

          const result = calculateProratedAllowance({
            annualAllowance: allowance,
            year: 2026,
            startDate,
            fteRatio: fte,
          });

          const maxAllowed = Math.round(allowance * fte * 100) / 100;
          expect(result).toBeGreaterThanOrEqual(0);
          expect(result).toBeLessThanOrEqual(maxAllowed + 0.05); // account for floating rounding
        },
      ),
      { numRuns: 100 },
    );
  });
});
