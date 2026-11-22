import { describe, it, expect } from "vitest";
import {
  accrualPlanPeriod,
  finalAccrualSourceRef,
  planFinalAccrual,
} from "../src/leave/accrual-runs.js";
import {
  accrualSourceRefPrefix,
  planAccrual,
} from "../src/leave/accrual-plan.js";

const policy = (
  accrualMethod: "upfront" | "monthly" | "daily",
  annualAllowanceDays = 24,
) => ({ id: "p1", annualAllowanceDays, accrualMethod });

describe("accrualPlanPeriod (LEA-002, #129)", () => {
  it("accrues the ended month for monthly and daily policies", () => {
    expect(accrualPlanPeriod("monthly", "2026-12")).toBe("2026-12");
    expect(accrualPlanPeriod("daily", "2026-02")).toBe("2026-02");
  });

  it("credits upfront policies for the month that is starting", () => {
    expect(accrualPlanPeriod("upfront", "2026-05")).toBe("2026-06");
    // The December run credits the next year on 1 January.
    expect(accrualPlanPeriod("upfront", "2026-12")).toBe("2027-01");
  });
});

describe("upfront crediting at the start of the year or employment (#129)", () => {
  it("credits the whole year on 1 January from the December run", () => {
    const period = accrualPlanPeriod("upfront", "2026-12");
    expect(
      planAccrual({
        policy: policy("upfront", 30),
        assignments: [{ start: "2020-01-01", end: null }],
        employment: [{ start: "2020-01-01", end: null }],
        fteRatio: 1,
        period,
        accruedCents: 0,
      }),
    ).toEqual({
      status: "accrue",
      amount: 30,
      sourceRef: "accrual:p1:2027-01",
      effectiveDate: "2027-01-01",
    });
  });

  it("credits a mid-year joiner from the run before their first month, prorated", () => {
    // Joins 15 June 2028 (leap year): the May run credits June.
    const period = accrualPlanPeriod("upfront", "2028-05");
    expect(
      planAccrual({
        policy: policy("upfront", 30),
        assignments: [{ start: "2020-01-01", end: null }],
        employment: [{ start: "2028-06-15", end: null }],
        fteRatio: 1,
        period,
        accruedCents: 0,
      }),
    ).toEqual({
      status: "accrue",
      // 30 × 200 / 366
      amount: 16.39,
      sourceRef: "accrual:p1:2028-06",
      effectiveDate: "2028-06-15",
    });
    // The run before (April run, planning May) credits nothing yet.
    expect(
      planAccrual({
        policy: policy("upfront", 30),
        assignments: [{ start: "2020-01-01", end: null }],
        employment: [{ start: "2028-06-15", end: null }],
        fteRatio: 1,
        period: accrualPlanPeriod("upfront", "2028-04"),
        accruedCents: 0,
      }),
    ).toEqual({ status: "up_to_date" });
  });
});

describe("planFinalAccrual (LEA-002, #116)", () => {
  const veteran = {
    assignments: [{ start: "2026-01-01", end: null }],
    employment: [{ start: "2020-01-01", end: null }],
    fteRatio: 1,
  };

  it("is up to date when December was accrued and nothing changed", () => {
    expect(
      planFinalAccrual({
        ...veteran,
        policy: policy("monthly"),
        year: 2026,
        accruedCents: 2400,
      }),
    ).toEqual({ status: "up_to_date" });
  });

  it("claws back a termination recorded after December was accrued", () => {
    expect(
      planFinalAccrual({
        ...veteran,
        employment: [{ start: "2020-01-01", end: "2026-11-30" }],
        policy: policy("monthly"),
        year: 2026,
        accruedCents: 2400,
      }),
    ).toEqual({
      status: "over_accrued",
      excessCents: 200,
      amount: -2,
      sourceRef: "accrual:p1:2026-final",
      effectiveDate: "2026-11-30",
    });
  });

  it("writes a missed December under the final ref", () => {
    expect(
      planFinalAccrual({
        ...veteran,
        policy: policy("monthly"),
        year: 2026,
        accruedCents: 2200,
      }),
    ).toEqual({
      status: "accrue",
      amount: 2,
      sourceRef: "accrual:p1:2026-final",
      effectiveDate: "2026-12-01",
    });
  });

  it("handles a leap year with daily accrual", () => {
    expect(
      planFinalAccrual({
        ...veteran,
        assignments: [{ start: "2028-01-01", end: null }],
        policy: policy("daily", 36.6),
        year: 2028,
        accruedCents: 3600,
      }),
    ).toMatchObject({ status: "accrue", amount: 0.6 });
  });

  it("names a ref that counts toward the year it settles", () => {
    expect(
      finalAccrualSourceRef("p1", 2026).startsWith(
        accrualSourceRefPrefix("p1", 2026),
      ),
    ).toBe(true);
  });

  it("rejects a fractional year", () => {
    expect(() =>
      planFinalAccrual({
        ...veteran,
        policy: policy("monthly"),
        year: 2026.5,
        accruedCents: 0,
      }),
    ).toThrow(RangeError);
  });
});
