import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  carryoverExpiryDate,
  isCarryoverDue,
  planCarryoverExpiry,
  planYearEnd,
  typeBalanceCentsAt,
  yearEndBalance,
  type LedgerRow,
  type YearEndEnforcement,
} from "../src/leave/year-end.js";
import { protectsVacation } from "../src/leave/protected-leave.js";

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

const enforced = (
  carryoverMaxDays: number,
  carryoverExpiryMonths = 3,
): YearEndEnforcement => ({ carryoverMaxDays, carryoverExpiryMonths });

const close = (
  balanceCents: number,
  enforcement: YearEndEnforcement | null,
  year = 2026,
) => planYearEnd({ leaveTypeId: "vac", year, balanceCents, enforcement });

describe("planYearEnd, enforced (LEA-002, #116)", () => {
  it("carries over up to the cap, forfeits the rest and sets the expiry", () => {
    expect(close(850, enforced(5))).toEqual({
      carryoverCents: 500,
      forfeitCents: 350,
      expiresOn: "2027-03-31",
      entries: [
        {
          entryType: "carryover",
          amount: -5,
          sourceRef: "carryover:vac:2026:close",
          effectiveDate: "2026-12-31",
          expiresOn: null,
        },
        {
          entryType: "carryover",
          amount: 5,
          sourceRef: "carryover:vac:2026",
          effectiveDate: "2027-01-01",
          expiresOn: "2027-03-31",
        },
        {
          entryType: "forfeit",
          amount: -3.5,
          sourceRef: "forfeit:vac:2026",
          effectiveDate: "2026-12-31",
          expiresOn: null,
        },
      ],
    });
  });

  it("carries everything over when the cap is not reached", () => {
    const plan = close(300, enforced(5));
    expect(plan).toMatchObject({ carryoverCents: 300, forfeitCents: 0 });
    expect(plan.entries.map((e) => e.entryType)).toEqual([
      "carryover",
      "carryover",
    ]);
  });

  it("carries exactly the cap when the balance equals it", () => {
    expect(close(500, enforced(5))).toMatchObject({
      carryoverCents: 500,
      forfeitCents: 0,
    });
  });

  it("forfeits everything when the policy carries nothing over", () => {
    expect(close(425, enforced(0))).toEqual({
      carryoverCents: 0,
      forfeitCents: 425,
      expiresOn: "2027-03-31",
      entries: [
        {
          entryType: "forfeit",
          amount: -4.25,
          sourceRef: "forfeit:vac:2026",
          effectiveDate: "2026-12-31",
          expiresOn: null,
        },
      ],
    });
  });

  it.each([0, -150])("writes nothing for a balance of %i cents", (b) => {
    expect(close(b, enforced(5)).entries).toEqual([]);
    expect(close(b, null).entries).toEqual([]);
  });

  it("opens the next year on 1 January across a leap year", () => {
    const plan = close(100, enforced(5, 2), 2027);
    expect(plan.entries.map((e) => e.effectiveDate)).toEqual([
      "2027-12-31",
      "2028-01-01",
    ]);
    expect(plan.expiresOn).toBe("2028-02-29");
  });

  it("rejects invalid input", () => {
    expect(() =>
      planYearEnd({
        leaveTypeId: "vac",
        year: 2026.5,
        balanceCents: 100,
        enforcement: null,
      }),
    ).toThrow(RangeError);
    expect(() => close(1.5, null)).toThrow(RangeError);
    expect(() => close(100, enforced(NaN))).toThrow(RangeError);
    expect(() => close(100, enforced(5, 1.5))).toThrow(RangeError);
  });
});

describe("planYearEnd, not enforced (default)", () => {
  it("carries the whole balance over, forfeits nothing and never expires", () => {
    expect(close(2_350, null)).toEqual({
      carryoverCents: 2_350,
      forfeitCents: 0,
      expiresOn: null,
      entries: [
        {
          entryType: "carryover",
          amount: -23.5,
          sourceRef: "carryover:vac:2026:close",
          effectiveDate: "2026-12-31",
          expiresOn: null,
        },
        {
          entryType: "carryover",
          amount: 23.5,
          sourceRef: "carryover:vac:2026",
          effectiveDate: "2027-01-01",
          expiresOn: null,
        },
      ],
    });
  });
});

describe("protectsVacation (ET art. 38.3)", () => {
  it("protects incapacity, pregnancy, birth, adoption and breastfeeding", () => {
    for (const code of [
      "sick_leave",
      "birth_childcare",
      "prenatal_exams",
      "adoption",
      "breastfeeding",
    ]) {
      expect(protectsVacation(code, false)).toBe(true);
      expect(protectsVacation(code, true)).toBe(true);
    }
  });

  it("does not protect vacation or ordinary permits", () => {
    expect(protectsVacation("vacation", true)).toBe(false);
    expect(protectsVacation("personal_days", true)).toBe(false);
    expect(protectsVacation("marriage", false)).toBe(false);
    expect(protectsVacation("moving", false)).toBe(false);
  });

  it("treats an unknown non-entitlement type as protecting (safe fallback)", () => {
    expect(protectsVacation("other", false)).toBe(true);
    expect(protectsVacation("custom_illness", false)).toBe(true);
    expect(protectsVacation("other", true)).toBe(false);
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

describe("carryoverExpiryDate and isCarryoverDue", () => {
  it("is the end of the configured month of the next year", () => {
    expect(carryoverExpiryDate(2026, 3)).toBe("2027-03-31");
    expect(carryoverExpiryDate(2027, 2)).toBe("2028-02-29"); // leap year
    expect(carryoverExpiryDate(2026, 2)).toBe("2027-02-28");
    expect(carryoverExpiryDate(2026, 12)).toBe("2027-12-31");
  });

  it("is due once the last usable day has ended", () => {
    expect(isCarryoverDue("2027-03-31", "2027-03-30")).toBe(false);
    expect(isCarryoverDue("2027-03-31", "2027-03-31")).toBe(true);
    expect(isCarryoverDue("2027-12-31", "2027-12-31")).toBe(true);
  });
});

describe("planCarryoverExpiry (LEA-002, #116)", () => {
  const base = {
    leaveTypeId: "vac",
    year: 2026,
    carriedCents: 500,
    expiresOn: "2027-03-31",
    usedCents: 0,
    balanceCents: 2_000,
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
      expiresOn: null,
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
    const leap = { ...base, year: 2027, expiresOn: "2028-02-29" };
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
  const months = fc.integer({ min: 1, max: 12 });
  const balance = fc.integer({ min: -50_000, max: 99_999 });
  const enforcement = fc.option(
    fc.record({ carryoverMaxDays: cap, carryoverExpiryMonths: months }),
    { nil: null },
  );

  it("carry-over plus forfeit equals the positive year-end balance", () => {
    fc.assert(
      fc.property(balance, enforcement, (balanceCents, e) => {
        const plan = close(balanceCents, e);
        expect(plan.carryoverCents + plan.forfeitCents).toBe(
          Math.max(0, balanceCents),
        );
        if (e) {
          expect(plan.carryoverCents).toBeLessThanOrEqual(
            Math.round(e.carryoverMaxDays * 100),
          );
        }
        expect(plan.forfeitCents).toBeGreaterThanOrEqual(0);
        // The balance only drops by the forfeited days.
        expect(sumCents(plan.entries) + plan.forfeitCents).toBe(0);
      }),
    );
  });

  it("not enforced: never a forfeit or an expiry, carry-over is the positive balance", () => {
    fc.assert(
      fc.property(balance, (balanceCents) => {
        const plan = close(balanceCents, null);
        expect(plan.forfeitCents).toBe(0);
        expect(plan.carryoverCents).toBe(Math.max(0, balanceCents));
        expect(plan.expiresOn).toBeNull();
        expect(
          plan.entries.every(
            (e) => e.entryType === "carryover" && e.expiresOn === null,
          ),
        ).toBe(true);
        // Nothing to expire later either: the balance is unchanged.
        expect(sumCents(plan.entries)).toBe(0);
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
      fc.property(ledgerRows, enforcement, (rows, e) => {
        const closeLedger = (ledger: readonly LedgerRow[]) => {
          const { balanceCents, closed } = yearEndBalance(ledger, "vac", 2026);
          if (closed) return [];
          return close(balanceCents, e).entries.map((entry) => ({
            ...entry,
            leaveTypeId: "vac",
          }));
        };
        const once = [...rows, ...closeLedger(rows)];
        const twice = [...once, ...closeLedger(once)];
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
        months,
        fc.constantFrom("2027-01-31", "2027-06-30", "2027-12-31", "2028-01-31"),
        fc.integer({ min: -99_999, max: 99_999 }),
        (carriedCents, usedCents, m, runDate, balanceCents) => {
          const entry = planCarryoverExpiry({
            leaveTypeId: "vac",
            year: 2026,
            carriedCents,
            expiresOn: carryoverExpiryDate(2026, m),
            usedCents,
            balanceCents,
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
