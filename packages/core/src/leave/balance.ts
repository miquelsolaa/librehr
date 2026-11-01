import { foldLedgerToBalance, type LeaveLedgerEntry } from "./ledger.js";

export interface LeaveBalanceSummary {
  currentBalance: number;
  totalAccrued: number;
  totalUsed: number;
  totalAdjusted: number;
  totalExpired: number;
}

export function computeBalanceSummary(
  entries: readonly LeaveLedgerEntry[],
): LeaveBalanceSummary {
  let totalAccrued = 0;
  let totalUsed = 0;
  let totalAdjusted = 0;
  let totalExpired = 0;

  for (const entry of entries) {
    switch (entry.entryType) {
      case "accrual":
      case "carryover":
        totalAccrued += entry.amount;
        break;
      case "usage":
        totalUsed += Math.abs(entry.amount);
        break;
      case "adjustment":
        totalAdjusted += entry.amount;
        break;
      case "expiry":
        totalExpired += Math.abs(entry.amount);
        break;
    }
  }

  return {
    currentBalance: foldLedgerToBalance(entries),
    totalAccrued: Math.round(totalAccrued * 100) / 100,
    totalUsed: Math.round(totalUsed * 100) / 100,
    totalAdjusted: Math.round(totalAdjusted * 100) / 100,
    totalExpired: Math.round(totalExpired * 100) / 100,
  };
}
