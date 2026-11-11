export type LeaveEntryType =
  "accrual" | "usage" | "adjustment" | "carryover" | "expiry" | "reversal";

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

/**
 * The balance after each entry of a ledger given in chronological order, so a
 * history can show where every figure comes from. The last value equals
 * `foldLedgerToBalance` of the same entries.
 *
 * @example
 * runningBalances([{ amount: 22 }, { amount: -5 }, { amount: 0.5 }]);
 * // [22, 17, 17.5]
 */
export function runningBalances(
  entries: readonly { readonly amount: number }[],
): number[] {
  let sum = 0;
  return entries.map((entry) => {
    sum += entry.amount;
    return Math.round(sum * 100) / 100;
  });
}
