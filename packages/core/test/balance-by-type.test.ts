import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  availableForLeaveType,
  balancesByLeaveType,
  runningBalancesByLeaveType,
  type TypedLedgerAmount,
} from "../src/leave/balance-by-type.js";
import { foldLedgerToBalance } from "../src/leave/ledger.js";
import { validateLeaveRequest } from "../src/leave/validate-request.js";

// LEA-005: balances per leave type, unassigned legacy entries kept apart.
const VAC = "vac";
const PD = "pd";

const entry = (
  leaveTypeId: string | null,
  entryType: string,
  amount: number,
): TypedLedgerAmount => ({ leaveTypeId, entryType, amount });

// Ledger amounts are numeric(5,2): half days and cents of a day.
const amount = fc.integer({ min: -3000, max: 3000 }).map((n) => n / 100);
const typeId = fc.constantFrom<string | null>(VAC, PD, "sick", null);
const ledger = fc.array(
  fc.record({
    leaveTypeId: typeId,
    entryType: fc.constantFrom(
      "accrual",
      "usage",
      "adjustment",
      "carryover",
      "expiry",
      "reversal",
    ),
    amount,
  }),
  { maxLength: 40 },
);

describe("balancesByLeaveType", () => {
  it("keeps vacation and personal days apart", () => {
    const balances = balancesByLeaveType([
      entry(VAC, "accrual", 22),
      entry(PD, "accrual", 2),
      entry(VAC, "usage", -3),
      entry(VAC, "reversal", 3),
      entry(VAC, "usage", -0.5),
      entry(PD, "carryover", 1),
    ]);
    expect(balances).toEqual([
      {
        leaveTypeId: VAC,
        currentBalance: 21.5,
        totalAccrued: 22,
        totalUsed: 3.5,
        totalCarryover: 0,
        totalAdjustments: 3,
      },
      {
        leaveTypeId: PD,
        currentBalance: 3,
        totalAccrued: 2,
        totalUsed: 0,
        totalCarryover: 1,
        totalAdjustments: 0,
      },
    ]);
  });

  it("reports unassigned legacy entries in their own bucket, last", () => {
    const balances = balancesByLeaveType([
      entry(null, "adjustment", 20),
      entry(VAC, "usage", -2),
    ]);
    expect(balances.map((b) => [b.leaveTypeId, b.currentBalance])).toEqual([
      [VAC, -2],
      [null, 20],
    ]);
  });

  it("is empty for an empty ledger", () => {
    expect(balancesByLeaveType([])).toEqual([]);
  });

  it("does not accumulate floating point drift", () => {
    const [b] = balancesByLeaveType([
      entry(VAC, "accrual", 0.1),
      entry(VAC, "accrual", 0.2),
      entry(VAC, "usage", -0.3),
    ]);
    expect(b?.currentBalance).toBe(0);
  });

  it("property: the type balances add up to the whole ledger", () => {
    fc.assert(
      fc.property(ledger, (entries) => {
        const balances = balancesByLeaveType(entries);
        const sumCents = balances.reduce(
          (s, b) => s + Math.round(b.currentBalance * 100),
          0,
        );
        expect(sumCents / 100).toBe(
          foldLedgerToBalance(
            entries.map((e, i) => ({
              id: String(i),
              employeeId: "e",
              entryType: "adjustment",
              amount: e.amount,
              effectiveDate: "2026-01-01",
            })),
          ),
        );
        // One bucket per distinct type, unassigned last.
        expect(new Set(balances.map((b) => b.leaveTypeId)).size).toBe(
          balances.length,
        );
        const nullIndex = balances.findIndex((b) => b.leaveTypeId === null);
        if (nullIndex >= 0) expect(nullIndex).toBe(balances.length - 1);
      }),
    );
  });

  it("property: a type's balance only depends on its own entries", () => {
    fc.assert(
      fc.property(ledger, ledger, (a, b) => {
        const vacOf = (entries: TypedLedgerAmount[]) =>
          balancesByLeaveType(entries).find((x) => x.leaveTypeId === VAC);
        const others = b.filter((e) => e.leaveTypeId !== VAC);
        expect(vacOf([...a, ...others])).toEqual(vacOf(a));
      }),
    );
  });
});

describe("runningBalancesByLeaveType", () => {
  it("runs one balance per type", () => {
    expect(
      runningBalancesByLeaveType([
        entry(VAC, "accrual", 22),
        entry(PD, "accrual", 2),
        entry(VAC, "usage", -3),
        entry(null, "adjustment", 1),
        entry(PD, "usage", -0.5),
      ]),
    ).toEqual([22, 2, 19, 1, 1.5]);
  });

  it("property: each type's last running value is its balance", () => {
    fc.assert(
      fc.property(ledger, (entries) => {
        const running = runningBalancesByLeaveType(entries);
        expect(running).toHaveLength(entries.length);
        for (const b of balancesByLeaveType(entries)) {
          let last: number | undefined;
          entries.forEach((e, i) => {
            if (e.leaveTypeId === b.leaveTypeId) last = running[i];
          });
          expect(last).toBe(b.currentBalance);
        }
      }),
    );
  });
});

describe("availableForLeaveType", () => {
  it("is the type's own balance when there are no legacy entries", () => {
    const entries = [
      entry(VAC, "accrual", 22),
      entry(PD, "accrual", 2),
      entry(VAC, "usage", -3),
    ];
    expect(availableForLeaveType(entries, VAC)).toBe(19);
    expect(availableForLeaveType(entries, PD)).toBe(2);
    // A type with no entries of its own has nothing to draw on.
    expect(availableForLeaveType(entries, "sick")).toBe(0);
  });

  it("shares a legacy pool between types without spending it twice", () => {
    const entries = [
      entry(null, "adjustment", 20),
      entry(VAC, "usage", -5),
      entry(PD, "usage", -2),
    ];
    // 20 - 5 - 2 = 13 left, whichever type asks.
    expect(availableForLeaveType(entries, VAC)).toBe(13);
    expect(availableForLeaveType(entries, PD)).toBe(13);
  });

  it("never lends another type's positive balance", () => {
    const entries = [entry(PD, "accrual", 5), entry(null, "adjustment", 1)];
    expect(availableForLeaveType(entries, VAC)).toBe(1);
  });

  it("ignores a negative legacy pool", () => {
    const entries = [entry(null, "adjustment", -4), entry(VAC, "accrual", 3)];
    expect(availableForLeaveType(entries, VAC)).toBe(3);
  });

  it("property: own balance <= available <= own + positive legacy pool", () => {
    fc.assert(
      fc.property(ledger, typeId, (entries, t) => {
        const target = t ?? VAC;
        const own = entries
          .filter((e) => e.leaveTypeId === target)
          .reduce((s, e) => s + Math.round(e.amount * 100), 0);
        const legacy = entries
          .filter((e) => e.leaveTypeId === null)
          .reduce((s, e) => s + Math.round(e.amount * 100), 0);
        const available = Math.round(
          availableForLeaveType(entries, target) * 100,
        );
        expect(available).toBeGreaterThanOrEqual(own);
        expect(available).toBeLessThanOrEqual(own + Math.max(0, legacy));
      }),
    );
  });

  it("property: a legacy-only ledger decides like the old pooled balance", () => {
    // Before 0033 every request was checked against the sum of all entries.
    // With no positive typed balance, the per-type check must agree.
    const legacyLedger = fc.array(
      fc.oneof(
        fc.record({
          leaveTypeId: fc.constant<string | null>(null),
          entryType: fc.constant("adjustment"),
          amount,
        }),
        fc.record({
          leaveTypeId: fc.constantFrom<string | null>(VAC, PD),
          entryType: fc.constant("usage"),
          amount: amount.map((a) => -Math.abs(a)),
        }),
      ),
      { maxLength: 30 },
    );
    fc.assert(
      fc.property(
        legacyLedger,
        fc.constantFrom(VAC, PD),
        fc.integer({ min: 1, max: 60 }).map((n) => n / 2),
        (entries, target, requested) => {
          const total =
            entries.reduce((s, e) => s + Math.round(e.amount * 100), 0) / 100;
          const available = availableForLeaveType(entries, target);
          expect(available - requested >= 0).toBe(total - requested >= 0);
        },
      ),
    );
  });
});

describe("validateLeaveRequest with a per-type balance", () => {
  it("checks the available balance instead of the folded ledger", () => {
    const base = {
      proposal: { startDate: "2026-06-01", endDate: "2026-06-03" },
      // 10 days in the ledger, but only 1 available for this leave type.
      ledgerEntries: [
        {
          id: "1",
          employeeId: "e1",
          entryType: "accrual" as const,
          amount: 10,
          effectiveDate: "2026-01-01",
        },
      ],
      existingRequests: [],
    };
    const res = validateLeaveRequest({ ...base, availableBalance: 1 });
    expect(res.valid).toBe(false);
    if (!res.valid) expect(res.reason).toBe("INSUFFICIENT_BALANCE");
    expect(validateLeaveRequest(base).valid).toBe(true);
  });
});
