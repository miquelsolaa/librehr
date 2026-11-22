/**
 * Per leave type balances (LEA-005). Every ledger entry counts toward exactly
 * one bucket: its leave type, or the "unassigned" bucket (`leaveTypeId`
 * null) for legacy entries written before the ledger recorded a type.
 *
 * Unassigned entries are never added to a leave type's balance: each
 * balance is the plain sum of its own entries, so "why is my vacation
 * balance 12.5?" is answered by the vacation entries alone. For request
 * validation only, a positive unassigned balance acts as a shared legacy
 * pool (see `availableForLeaveType`), so installations that recorded
 * balances before 0033 keep working until HR re-books them per type. Only
 * leave types the employee has a policy for are balance-limited.
 *
 * Sums are kept in integer cents of a day, matching `leave_ledger.amount`
 * (numeric(5,2)), so no floating point drift reaches a balance.
 */

export interface TypedLedgerAmount {
  /** Null for a legacy entry with no recorded leave type. */
  leaveTypeId: string | null;
  entryType: string;
  amount: number;
}

export interface LeaveTypeBalance {
  /** Null is the unassigned (legacy) bucket. */
  leaveTypeId: string | null;
  currentBalance: number;
  totalAccrued: number;
  totalUsed: number;
  totalCarryover: number;
  /** Adjustments and compensating reversals. */
  totalAdjustments: number;
  /**
   * Days lost at year end (`forfeit`) or when carried-over days expired
   * (`expiry`), as a positive number. Accrued − used + carry-over +
   * adjustments − expired is the balance.
   */
  totalExpired: number;
}

const cents = (amount: number) => Math.round(amount * 100);
const days = (c: number) => c / 100;

interface Totals {
  balance: number;
  accrued: number;
  used: number;
  carryover: number;
  adjustments: number;
  expired: number;
}

function totalsByType(
  entries: readonly TypedLedgerAmount[],
): Map<string | null, Totals> {
  const byType = new Map<string | null, Totals>();
  for (const e of entries) {
    const t = byType.get(e.leaveTypeId) ?? {
      balance: 0,
      accrued: 0,
      used: 0,
      carryover: 0,
      adjustments: 0,
      expired: 0,
    };
    const c = cents(e.amount);
    t.balance += c;
    if (e.entryType === "accrual") t.accrued += c;
    else if (e.entryType === "usage") t.used += Math.abs(c);
    else if (e.entryType === "carryover") t.carryover += c;
    else if (e.entryType === "adjustment" || e.entryType === "reversal")
      t.adjustments += c;
    else if (e.entryType === "forfeit" || e.entryType === "expiry")
      t.expired -= c;
    byType.set(e.leaveTypeId, t);
  }
  return byType;
}

/**
 * One balance per leave type that has entries, in order of each type's first
 * entry, with the unassigned bucket (if any) last. The balances add up to
 * the sum of all entries.
 *
 * @example
 * balancesByLeaveType([
 *   { leaveTypeId: "vac", entryType: "accrual", amount: 22 },
 *   { leaveTypeId: "pd", entryType: "accrual", amount: 2 },
 *   { leaveTypeId: "vac", entryType: "usage", amount: -3 },
 * ]);
 * // => [{ leaveTypeId: "vac", currentBalance: 19, totalAccrued: 22, totalUsed: 3, ... },
 * //     { leaveTypeId: "pd", currentBalance: 2, totalAccrued: 2, totalUsed: 0, ... }]
 */
export function balancesByLeaveType(
  entries: readonly TypedLedgerAmount[],
): LeaveTypeBalance[] {
  const result: LeaveTypeBalance[] = [];
  let unassigned: LeaveTypeBalance | null = null;
  for (const [leaveTypeId, t] of totalsByType(entries)) {
    const row: LeaveTypeBalance = {
      leaveTypeId,
      currentBalance: days(t.balance),
      totalAccrued: days(t.accrued),
      totalUsed: days(t.used),
      totalCarryover: days(t.carryover),
      totalAdjustments: days(t.adjustments),
      totalExpired: days(t.expired),
    };
    if (leaveTypeId === null) unassigned = row;
    else result.push(row);
  }
  if (unassigned) result.push(unassigned);
  return result;
}

/**
 * The balance of an entry's own leave type (or the unassigned bucket) once
 * the entry is applied, for entries in chronological order. The last value
 * of each type equals that type's `currentBalance`.
 *
 * @example
 * runningBalancesByLeaveType([
 *   { leaveTypeId: "vac", entryType: "accrual", amount: 22 },
 *   { leaveTypeId: "pd", entryType: "accrual", amount: 2 },
 *   { leaveTypeId: "vac", entryType: "usage", amount: -3 },
 * ]); // => [22, 2, 19]
 */
export function runningBalancesByLeaveType(
  entries: readonly TypedLedgerAmount[],
): number[] {
  const sums = new Map<string | null, number>();
  return entries.map((e) => {
    const next = (sums.get(e.leaveTypeId) ?? 0) + cents(e.amount);
    sums.set(e.leaveTypeId, next);
    return days(next);
  });
}

/**
 * Days a new request of `leaveTypeId` may draw on: the type's own balance
 * plus whatever positive unassigned (legacy) balance is left once the
 * shortfall of every other balance-limited type has been covered by it.
 *
 * Only types in `limitedTypeIds` (the employee has a policy for them) draw
 * on the pool: leave that is never balance-limited, such as sick leave,
 * neither spends it nor is checked against it. The pool is shared, so the
 * same legacy day can never back requests of two limited types; and when no
 * limited type has a positive balance of its own (a ledger written before
 * 0033), this reproduces the old pooled balance for those types.
 *
 * @example
 * // 20 legacy days, 5 used as personal days, 3 sick days, no vacation yet:
 * availableForLeaveType(
 *   [
 *     { leaveTypeId: null, entryType: "adjustment", amount: 20 },
 *     { leaveTypeId: "pd", entryType: "usage", amount: -5 },
 *     { leaveTypeId: "sick", entryType: "usage", amount: -3 },
 *   ],
 *   "vac",
 *   new Set(["vac", "pd"]),
 * ); // => 15
 */
export function availableForLeaveType(
  entries: readonly TypedLedgerAmount[],
  leaveTypeId: string,
  limitedTypeIds: ReadonlySet<string>,
): number {
  const totals = totalsByType(entries);
  const own = totals.get(leaveTypeId)?.balance ?? 0;
  let pool = totals.get(null)?.balance ?? 0;
  for (const [typeId, t] of totals) {
    if (typeId !== null && typeId !== leaveTypeId && limitedTypeIds.has(typeId))
      pool += Math.min(0, t.balance);
  }
  return days(own + Math.max(0, pool));
}
