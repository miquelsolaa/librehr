import { describe, it, expect } from "vitest";
import {
  generatePinSalt,
  hashKioskPin,
  verifyKioskPin,
  calculateTimeBankBalance,
  type TimeBankEntry,
} from "../src/time/index.js";

describe("Kiosk PIN and Time Bank (TIM-010, TIM-012)", () => {
  describe("Kiosk PIN hashing & verification (TIM-010)", () => {
    it("generates 32-char hex salt", () => {
      const salt = generatePinSalt();
      expect(salt).toHaveLength(32);
    });

    it("hashes pin deterministically with same salt", () => {
      const salt = "0123456789abcdef0123456789abcdef";
      const hash1 = hashKioskPin("1234", salt);
      const hash2 = hashKioskPin("1234", salt);
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64);
    });

    it("produces different hashes for different pins or salts", () => {
      const salt1 = "0123456789abcdef0123456789abcdef";
      const salt2 = "fedcba9876543210fedcba9876543210";
      const hash1 = hashKioskPin("1234", salt1);
      const hash2 = hashKioskPin("1234", salt2);
      const hash3 = hashKioskPin("4321", salt1);

      expect(hash1).not.toBe(hash2);
      expect(hash1).not.toBe(hash3);
    });

    it("verifies matching pin successfully", () => {
      const salt = generatePinSalt();
      const hash = hashKioskPin("9876", salt);
      expect(verifyKioskPin("9876", hash, salt)).toBe(true);
      expect(verifyKioskPin("0000", hash, salt)).toBe(false);
      expect(verifyKioskPin("", hash, salt)).toBe(false);
    });
  });

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
