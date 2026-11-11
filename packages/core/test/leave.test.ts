import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  foldLedgerToBalance,
  runningBalances,
  type LeaveLedgerEntry,
} from "../src/leave/ledger.js";
import { computeBalanceSummary } from "../src/leave/balance.js";
import { validateLeaveRequest } from "../src/leave/validate-request.js";

describe("Leave Domain Logic", () => {
  it("correctly folds append-only ledger entries into current balance", () => {
    const entries: LeaveLedgerEntry[] = [
      {
        id: "1",
        employeeId: "emp1",
        entryType: "accrual",
        amount: 22,
        effectiveDate: "2026-01-01",
      },
      {
        id: "2",
        employeeId: "emp1",
        entryType: "usage",
        amount: -5,
        effectiveDate: "2026-04-10",
      },
      {
        id: "3",
        employeeId: "emp1",
        entryType: "usage",
        amount: -3.5,
        effectiveDate: "2026-06-15",
      },
      {
        id: "4",
        employeeId: "emp1",
        entryType: "adjustment",
        amount: 1,
        effectiveDate: "2026-07-01",
      },
      {
        id: "5",
        employeeId: "emp1",
        entryType: "expiry",
        amount: -2,
        effectiveDate: "2026-12-31",
      },
    ];

    expect(foldLedgerToBalance(entries)).toBe(12.5);
    const summary = computeBalanceSummary(entries);
    expect(summary.totalAccrued).toBe(22);
    expect(summary.totalUsed).toBe(8.5);
    expect(summary.totalAdjusted).toBe(1);
    expect(summary.totalExpired).toBe(2);
    expect(summary.currentBalance).toBe(12.5);
  });

  it("property-based test: balance always equals sum of ledger entries", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            id: fc.uuid(),
            employeeId: fc.constant("emp-test"),
            entryType: fc.constantFrom<"accrual" | "usage" | "adjustment">(
              "accrual",
              "usage",
              "adjustment",
            ),
            amount: fc.double({ min: -30, max: 30, noNaN: true }),
            effectiveDate: fc.constant("2026-01-01"),
          }),
        ),
        (entries) => {
          const balance = foldLedgerToBalance(entries);
          const rawSum = entries.reduce((acc, e) => acc + e.amount, 0);
          const roundedSum = Math.round(rawSum * 100) / 100;
          expect(balance).toBe(roundedSum);
        },
      ),
    );
  });

  describe("runningBalances", () => {
    it("gives the balance after each entry, half days included", () => {
      expect(
        runningBalances([{ amount: 22 }, { amount: -5 }, { amount: -0.5 }]),
      ).toEqual([22, 17, 16.5]);
    });

    it("is empty for an empty ledger and may go negative", () => {
      expect(runningBalances([])).toEqual([]);
      expect(runningBalances([{ amount: -2 }, { amount: 1 }])).toEqual([
        -2, -1,
      ]);
    });

    it("does not accumulate floating point drift", () => {
      expect(
        runningBalances([{ amount: 0.1 }, { amount: 0.2 }, { amount: -0.3 }]),
      ).toEqual([0.1, 0.3, 0]);
    });

    it("property: ends on the folded balance and steps by each amount", () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              id: fc.uuid(),
              employeeId: fc.constant("emp-test"),
              entryType: fc.constantFrom<"accrual" | "usage">(
                "accrual",
                "usage",
              ),
              // Half-day steps, as the ledger stores them.
              amount: fc.integer({ min: -60, max: 60 }).map((n) => n / 2),
              effectiveDate: fc.constant("2026-01-01"),
            }),
          ),
          (entries) => {
            const balances = runningBalances(entries);
            expect(balances).toHaveLength(entries.length);
            expect(balances.at(-1) ?? 0).toBe(foldLedgerToBalance(entries));
            balances.forEach((value, i) => {
              const previous = i === 0 ? 0 : (balances[i - 1] ?? 0);
              expect(value - previous).toBe(entries[i]?.amount);
            });
          },
        ),
      );
    });
  });

  describe("validateLeaveRequest", () => {
    const baseLedger: LeaveLedgerEntry[] = [
      {
        id: "1",
        employeeId: "e1",
        entryType: "accrual",
        amount: 10,
        effectiveDate: "2026-01-01",
      },
    ];

    it("approves request with sufficient balance and no conflicts", () => {
      const res = validateLeaveRequest({
        proposal: { startDate: "2026-11-02", endDate: "2026-11-04" }, // 3 days
        ledgerEntries: baseLedger, // 10 days
        existingRequests: [],
      });

      expect(res.valid).toBe(true);
      if (res.valid) {
        expect(res.requiredDays).toBe(3);
        expect(res.remainingBalanceAfter).toBe(7);
      }
    });

    it("blocks request when start date is after end date", () => {
      const res = validateLeaveRequest({
        proposal: { startDate: "2026-11-05", endDate: "2026-11-02" },
        ledgerEntries: baseLedger,
        existingRequests: [],
      });

      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.reason).toBe("INVALID_DATES");
      }
    });

    it("blocks request with insufficient balance unless policy allows negative", () => {
      const res = validateLeaveRequest({
        proposal: { startDate: "2026-11-02", endDate: "2026-11-20" }, // 15 working days
        ledgerEntries: baseLedger, // 10 days
        existingRequests: [],
      });

      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.reason).toBe("INSUFFICIENT_BALANCE");
      }
    });

    it("allows negative balance when policy explicitly permits", () => {
      const res = validateLeaveRequest({
        proposal: { startDate: "2026-11-02", endDate: "2026-11-20" }, // 15 working days
        ledgerEntries: baseLedger, // 10 days
        existingRequests: [],
        allowNegativeBalance: true,
      });

      expect(res.valid).toBe(true);
      if (res.valid) {
        expect(res.remainingBalanceAfter).toBe(-5);
      }
    });

    it("blocks request overlapping with existing approved/pending request", () => {
      const existing = [
        {
          id: "req-1",
          startDate: "2026-11-04",
          endDate: "2026-11-06",
          status: "approved" as const,
        },
      ];

      const res = validateLeaveRequest({
        proposal: { startDate: "2026-11-02", endDate: "2026-11-05" }, // Overlaps on 4-5 Nov
        ledgerEntries: baseLedger,
        existingRequests: existing,
      });

      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.reason).toBe("OVERLAPPING_REQUEST");
      }
    });
  });
});
