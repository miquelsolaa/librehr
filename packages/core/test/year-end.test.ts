import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  carryoverExpiryDate,
  planCarryoverExpiry,
  planYearEnd,
  typeBalanceCentsAt,
  yearEndBalance,
  type LedgerRow,
} from "../src/leave/year-end.js";

const row = (
  amount: number,
  effectiveDate: string,
  overrides: Partial<LedgerRow> = {},
): LedgerRow => ({
  leaveTypeId: "vac",
  entryType: "accrual",
  amount,
  sourceRef: null,
  effectiveDate,
  ...overrides,
});

const sumCents = (rows: readonly { amount: number }[]) =>
  rows.reduce((s, r) => s + Math.round(r.amount * 100), 0);

describe("planYearEnd (LEA-002, #116)", () => {
  it("carries over up to the cap and forfeits the rest", () => {
    expect(
      planYearEnd({
        leaveTypeId: "vac",
        year: 2026,
        balanceCents: 850,
        carryoverMaxDays: 5,
      }),
    ).toEqual({
      carryoverCents: 500,
      forfeitCents: 350,
      entries: [
        {
          entryType: "carryover",
          amount: -5,
          sourceRef: "carryover:vac:2026:close",
          effectiveDate: "2026-12-31",
        },
        {
          entryType: "carryover",
          amount: 5,
          sourceRef: "carryover:vac:2026",
          effectiveDate: "2027-01-01",
        },
        {
          entryType: "forfeit",
          amount: -3.5,
          sourceRef: "forfeit:vac:2026",
          effectiveDate: "2026-12-31",
        },
      ],
    });
  });

  it("carries everything over when the cap is not reached", () => {
    const plan = planYearEnd({
      leaveTypeId: "vac",
      year: 2026,
      balanceCents: 300,
      carryoverMaxDays: 5,
    });
    expect(plan).toMatchObject({ carryoverCents: 300, forfeitCents: 0 });
    expect(plan.entries.map((e) => e.entryType)).toEqual([
      "carryover",
      "carryover",
    ]);
  });

  it("carries exactly the cap when the balance equals it", () => {
    expect(
      planYearEnd({
        leaveTypeId: "vac",
        year: 2026,
        balanceCents: 500,
        carryoverMaxDays: 5,
      }),
    ).toMatchObject({ carryoverCents: 500, forfeitCents: 0 });
  });

  it("forfeits everything when the policy carries nothing over", () => {
    expect(
      planYearEnd({
        leaveTypeId: "vac",
        year: 2026,
        balanceCents: 425,
        carryoverMaxDays: 0,
      }),
    ).toEqual({
      carryoverCents: 0,
      forfeitCents: 425,
      entries: [
        {
          entryType: "forfeit",
          amount: -4.25,
          sourceRef: "forfeit:vac:2026",
          effectiveDate: "2026-12-31",
        },
      ],
    });
  });

  it.each([0, -150])("writes nothing for a balance of %i cents", (b) => {
    expect(
      planYearEnd({
        leaveTypeId: "vac",
        year: 2026,
        balanceCents: b,
        carryoverMaxDays: 5,
      }),
    ).toEqual({ carryoverCents: 0, forfeitCents: 0, entries: [] });
  });

  it("opens the next year on 1 January across a leap year", () => {
    const plan = planYearEnd({
      leaveTypeId: "vac",
      year: 2027,
      balanceCents: 100,
      carryoverMaxDays: 5,
    });
    expect(plan.entries.map((e) => e.effectiveDate)).toEqual([
      "2027-12-31",
      "2028-01-01",
    ]);
  });

  it("rejects invalid input", () => {
    const base = {
      leaveTypeId: "vac",
      year: 2026,
      balanceCents: 100,
      carryoverMaxDays: 5,
    };
    expect(() => planYearEnd({ ...base, year: 2026.5 })).toThrow(RangeError);
    expect(() => planYearEnd({ ...base, balanceCents: 1.5 })).toThrow(
      RangeError,
    );
    expect(() => planYearEnd({ ...base, carryoverMaxDays: NaN })).toThrow(
      RangeError,
    );
  });
});

describe("yearEndBalance (LEA-005)", () => {
  it("sums the type's entries up to 31 December, ignoring other buckets", () => {
    expect(
      yearEndBalance(
        [
          row(22, "2026-01-01"),
          row(-12, "2026-08-03", { entryType: "usage", sourceRef: "r1" }),
          // Booked for next year: not part of this year's balance.
          row(-2, "2027-01-04", { entryType: "usage", sourceRef: "r2" }),
          // Unassigned and other types never count.
          row(5, "2026-02-01", { leaveTypeId: null }),
          row(3, "2026-02-01", { leaveTypeId: "pd" }),
        ],
        "vac",
        2026,
      ),
    ).toEqual({ balanceCents: 1000, closed: false });
  });

  it("includes an expiry of the year's own carried-in days (dated in the year)", () => {
    expect(
      yearEndBalance(
        [
          row(5, "2026-01-01", {
            entryType: "carryover",
            sourceRef: "carryover:vac:2025",
          }),
          row(-5, "2026-12-31", {
            entryType: "expiry",
            sourceRef: "expiry:vac:2025",
          }),
          row(22, "2026-01-01"),
        ],
        "vac",
        2026,
      ).balanceCents,
    ).toBe(2200);
  });
});

describe("carryoverExpiryDate", () => {
  it("is the end of the configured month of the next year", () => {
    expect(carryoverExpiryDate(2026, 3)).toBe("2027-03-31");
    expect(carryoverExpiryDate(2027, 2)).toBe("2028-02-29"); // leap year
    expect(carryoverExpiryDate(2026, 2)).toBe("2027-02-28");
    expect(carryoverExpiryDate(2026, 12)).toBe("2027-12-31");
  });
});

describe("planCarryoverExpiry (LEA-002, #116)", () => {
  const base = {
    leaveTypeId: "vac",
    year: 2026,
    carriedCents: 500,
    usedCents: 0,
    balanceCents: 2_000,
    carryoverExpiryMonths: 3,
  };

  it("writes nothing before the expiry date has passed", () => {
    expect(planCarryoverExpiry({ ...base, runDate: "2027-02-28" })).toBeNull();
    expect(planCarryoverExpiry({ ...base, runDate: "2027-03-30" })).toBeNull();
  });

  it("expires once the last usable day has ended", () => {
    // The run for runDate starts after that day: 31 March has ended.
    expect(planCarryoverExpiry({ ...base, runDate: "2027-03-31" })).toEqual({
      entryType: "expiry",
      amount: -5,
      sourceRef: "expiry:vac:2026",
      effectiveDate: "2027-03-31",
    });
    expect(
      planCarryoverExpiry({ ...base, runDate: "2027-06-30" }),
    ).toMatchObject({ amount: -5 });
  });

  it("expires only the carried days left after usage", () => {
    expect(
      planCarryoverExpiry({ ...base, usedCents: 150, runDate: "2027-04-30" }),
    ).toMatchObject({ amount: -3.5 });
  });

  it("expires nothing when the carried days were used up", () => {
    for (const usedCents of [500, 900]) {
      expect(
        planCarryoverExpiry({ ...base, usedCents, runDate: "2027-04-30" }),
      ).toBeNull();
    }
  });

  it("never takes the balance below zero", () => {
    // A negative adjustment left only 1.5 days on the expiry date.
    expect(
      planCarryoverExpiry({
        ...base,
        balanceCents: 150,
        runDate: "2027-04-30",
      }),
    ).toMatchObject({ amount: -1.5 });
    for (const balanceCents of [0, -300]) {
      expect(
        planCarryoverExpiry({ ...base, balanceCents, runDate: "2027-04-30" }),
      ).toBeNull();
    }
  });

  it("treats net negative usage as none", () => {
    expect(
      planCarryoverExpiry({ ...base, usedCents: -200, runDate: "2027-04-30" }),
    ).toMatchObject({ amount: -5 });
  });

  it("handles a February expiry in a leap year", () => {
    const leap = { ...base, year: 2027, carryoverExpiryMonths: 2 };
    expect(planCarryoverExpiry({ ...leap, runDate: "2028-02-28" })).toBeNull();
    expect(
      planCarryoverExpiry({ ...leap, runDate: "2028-02-29" }),
    ).toMatchObject({ effectiveDate: "2028-02-29" });
  });

  it("rejects invalid amounts", () => {
    expect(() =>
      planCarryoverExpiry({ ...base, carriedCents: -1, runDate: "2027-04-30" }),
    ).toThrow(RangeError);
    expect(() =>
      planCarryoverExpiry({ ...base, usedCents: 0.5, runDate: "2027-04-30" }),
    ).toThrow(RangeError);
    expect(() =>
      planCarryoverExpiry({
        ...base,
        balanceCents: 0.5,
        runDate: "2027-04-30",
      }),
    ).toThrow(RangeError);
  });
});

describe("typeBalanceCentsAt", () => {
  it("sums one type's entries up to and including the date", () => {
    expect(
      typeBalanceCentsAt(
        [
          row(5, "2027-01-01", { entryType: "carryover" }),
          row(-4, "2027-03-31", { entryType: "adjustment" }),
          row(-1, "2027-04-01", { entryType: "usage" }),
          row(9, "2027-01-01", { leaveTypeId: null }),
        ],
        "vac",
        "2027-03-31",
      ),
    ).toBe(100);
  });
});

describe("year-end properties", () => {
  const cap = fc.integer({ min: 0, max: 99_999 }).map((c) => c / 100);
  const balance = fc.integer({ min: -50_000, max: 99_999 });

  it("carry-over plus forfeit equals the positive year-end balance", () => {
    fc.assert(
      fc.property(balance, cap, (balanceCents, carryoverMaxDays) => {
        const plan = planYearEnd({
          leaveTypeId: "vac",
          year: 2026,
          balanceCents,
          carryoverMaxDays,
        });
        expect(plan.carryoverCents + plan.forfeitCents).toBe(
          Math.max(0, balanceCents),
        );
        expect(plan.carryoverCents).toBeLessThanOrEqual(
          Math.round(carryoverMaxDays * 100),
        );
        expect(plan.forfeitCents).toBeGreaterThanOrEqual(0);
        // The balance only drops by the forfeited days.
        expect(sumCents(plan.entries) + plan.forfeitCents).toBe(0);
      }),
    );
  });

  const ledgerRows = fc.array(
    fc.record({
      leaveTypeId: fc.constantFrom("vac", "pd", null),
      entryType: fc.constantFrom("accrual", "usage", "adjustment"),
      amount: fc.integer({ min: -3_000, max: 3_000 }).map((c) => c / 100),
      sourceRef: fc.constant(null),
      effectiveDate: fc.constantFrom(
        "2025-06-01",
        "2026-01-01",
        "2026-12-31",
        "2027-01-01",
      ),
    }),
    { maxLength: 30 },
  );

  it("re-running the year leaves the balance unchanged", () => {
    fc.assert(
      fc.property(ledgerRows, cap, (rows, carryoverMaxDays) => {
        const close = (ledger: readonly LedgerRow[]) => {
          const { balanceCents, closed } = yearEndBalance(ledger, "vac", 2026);
          if (closed) return [];
          return planYearEnd({
            leaveTypeId: "vac",
            year: 2026,
            balanceCents,
            carryoverMaxDays,
          }).entries.map((e) => ({ ...e, leaveTypeId: "vac" }));
        };
        const once = [...rows, ...close(rows)];
        const twice = [...once, ...close(once)];
        expect(twice).toEqual(once);
        // Other buckets, the unassigned one included, are never touched.
        for (const t of ["pd", null]) {
          const only = (l: readonly LedgerRow[]) =>
            sumCents(l.filter((r) => r.leaveTypeId === t));
          expect(only(once)).toBe(only(rows));
        }
        // After the close the year's balance is what was carried over.
        const before = yearEndBalance(rows, "vac", 2026).balanceCents;
        const after = sumCents(
          once.filter(
            (r) => r.leaveTypeId === "vac" && r.effectiveDate <= "2026-12-31",
          ),
        );
        if (before > 0) expect(after).toBe(0);
        else expect(after).toBe(before);
      }),
    );
  });

  it("expiry never exceeds the carried amount", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 99_999 }),
        fc.integer({ min: -99_999, max: 99_999 }),
        fc.integer({ min: 1, max: 12 }),
        fc.constantFrom("2027-01-31", "2027-06-30", "2027-12-31", "2028-01-31"),
        fc.integer({ min: -99_999, max: 99_999 }),
        (carriedCents, usedCents, months, runDate, balanceCents) => {
          const entry = planCarryoverExpiry({
            leaveTypeId: "vac",
            year: 2026,
            carriedCents,
            usedCents,
            balanceCents,
            carryoverExpiryMonths: months,
            runDate,
          });
          if (entry === null) return;
          const expired = -Math.round(entry.amount * 100);
          expect(expired).toBeGreaterThan(0);
          expect(expired).toBeLessThanOrEqual(carriedCents);
          // Never below zero: at most the balance on the expiry date.
          expect(expired).toBeLessThanOrEqual(balanceCents);
          expect(expired).toBeLessThanOrEqual(
            carriedCents - Math.max(0, usedCents),
          );
        },
      ),
    );
  });
});
