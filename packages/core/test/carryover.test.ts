import { describe, it, expect } from "vitest";
import {
  calculateCarryover,
  isCarryoverExpired,
} from "../src/leave/carryover.js";

describe("Leave Carryover & Expiration (LEA-002)", () => {
  it("carries over balance up to maximum cap and forfeits the rest", () => {
    const result = calculateCarryover({
      unusedBalance: 8.5,
      maxCarryoverDays: 5,
      expiryMonths: 3,
      year: 2025,
    });

    expect(result.carryoverAmount).toBe(5);
    expect(result.forfeitedAmount).toBe(3.5);
    expect(result.expiresAt).toBe("2026-03-31");
  });

  it("carries over full balance when within the cap", () => {
    const result = calculateCarryover({
      unusedBalance: 3,
      maxCarryoverDays: 5,
      expiryMonths: 3,
      year: 2025,
    });

    expect(result.carryoverAmount).toBe(3);
    expect(result.forfeitedAmount).toBe(0);
    expect(result.expiresAt).toBe("2026-03-31");
  });

  it("handles zero or negative balance gracefully", () => {
    const result = calculateCarryover({
      unusedBalance: 0,
      maxCarryoverDays: 5,
      expiryMonths: 3,
      year: 2025,
    });

    expect(result.carryoverAmount).toBe(0);
    expect(result.forfeitedAmount).toBe(0);
    expect(result.expiresAt).toBe("2026-03-31");
  });

  it("checks whether carryover has expired relative to current date", () => {
    const expiresAt = "2026-03-31";

    expect(isCarryoverExpired(expiresAt, "2026-03-15")).toBe(false);
    expect(isCarryoverExpired(expiresAt, "2026-03-31")).toBe(false);
    expect(isCarryoverExpired(expiresAt, "2026-04-01")).toBe(true);
  });
});
