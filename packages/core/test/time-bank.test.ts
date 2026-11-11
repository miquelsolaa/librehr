import { describe, it, expect } from "vitest";
import {
  calculateTimeBankBalance,
  type TimeBankEntry,
} from "../src/time/index.js";

describe("Time Bank (TIM-012)", () => {
  describe("Time Bank calculation (TIM-012)", () => {
    it("returns zero balance when no entries exist", () => {
      const res = calculateTimeBankBalance([]);
      expect(res.currentBalanceMinutes).toBe(0);
      expect(res.totalAccruedMinutes).toBe(0);
      expect(res.totalCompensatedMinutes).toBe(0);
      expect(res.currentBalanceHoursFormatted).toBe("0h 00m");
    });

    it("correctly sums overtime accruals and compensatory rest", () => {
      const entries: TimeBankEntry[] = [
        {
          type: "overtime_accrual",
          minutes: 120, // 2h
          referenceDate: "2026-11-01",
        },
        {
          type: "overtime_accrual",
          minutes: 90, // 1h 30m
          referenceDate: "2026-11-02",
        },
        {
          type: "compensatory_rest_taken",
          minutes: 60, // 1h
          referenceDate: "2026-11-03",
        },
      ];

      const res = calculateTimeBankBalance(entries);
      expect(res.totalAccruedMinutes).toBe(210);
      expect(res.totalCompensatedMinutes).toBe(60);
      expect(res.currentBalanceMinutes).toBe(150); // 2h 30m
      expect(res.currentBalanceHoursFormatted).toBe("+2h 30m");
    });

    it("handles negative balances and expired overtime", () => {
      const entries: TimeBankEntry[] = [
        {
          type: "overtime_accrual",
          minutes: 60,
          referenceDate: "2026-07-01",
        },
        {
          type: "expired",
          minutes: 60, // statutory 4-month expiry
          referenceDate: "2026-11-01",
        },
        {
          type: "compensatory_rest_taken",
          minutes: 45,
          referenceDate: "2026-11-02",
        },
      ];

      const res = calculateTimeBankBalance(entries);
      expect(res.currentBalanceMinutes).toBe(-45);
      expect(res.currentBalanceHoursFormatted).toBe("-0h 45m");
    });
  });
});
