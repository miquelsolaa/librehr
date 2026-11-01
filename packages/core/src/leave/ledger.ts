export type LeaveEntryType =
  "accrual" | "usage" | "adjustment" | "carryover" | "expiry";

export interface LeaveLedgerEntry {
  id: string;
  employeeId: string;
  entryType: LeaveEntryType;
  amount: number; // positive for accrual/positive adjustment/carryover; negative for usage/expiry
  effectiveDate: string; // YYYY-MM-DD
  sourceRef?: string;
  note?: string;
}

/**
 * Derives current leave balance by folding the append-only ledger entries.
 * Balance is always computed from history, never mutated directly in a balance column.
 */
export function foldLedgerToBalance(
  entries: readonly LeaveLedgerEntry[],
): number {
  const sum = entries.reduce((acc, entry) => acc + entry.amount, 0);
  // Round to 2 decimal places to avoid floating point inaccuracies
  return Math.round(sum * 100) / 100;
}
