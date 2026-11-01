export interface CarryoverOptions {
  unusedBalance: number;
  maxCarryoverDays: number;
  expiryMonths?: number | undefined; // default 3 (March 31 of next year)
  year: number; // The reference year ending
}

export interface CarryoverResult {
  carryoverAmount: number;
  forfeitedAmount: number;
  expiresAt: string; // YYYY-MM-DD
}

function getLastDayOfMonth(year: number, month: number): number {
  // month is 1-12
  const d = new Date(Date.UTC(year, month, 0));
  return d.getUTCDate();
}

/**
 * Calculates carried-over leave from previous year, applying statutory maximum caps
 * and computing the expiration deadline.
 */
export function calculateCarryover(options: CarryoverOptions): CarryoverResult {
  const { unusedBalance, maxCarryoverDays, expiryMonths = 3, year } = options;

  if (unusedBalance <= 0) {
    const nextYear = year + 1;
    const expMonth = Math.min(12, Math.max(1, expiryMonths));
    const lastDay = getLastDayOfMonth(nextYear, expMonth);
    const monthPad = String(expMonth).padStart(2, "0");
    const dayPad = String(lastDay).padStart(2, "0");
    return {
      carryoverAmount: 0,
      forfeitedAmount: 0,
      expiresAt: `${nextYear}-${monthPad}-${dayPad}`,
    };
  }

  const allowedMax = Math.max(0, maxCarryoverDays);
  const carryoverAmount = Math.min(unusedBalance, allowedMax);
  const forfeitedAmount = Math.max(
    0,
    Math.round((unusedBalance - carryoverAmount) * 100) / 100,
  );

  const nextYear = year + 1;
  const expMonth = Math.min(12, Math.max(1, expiryMonths));
  const lastDay = getLastDayOfMonth(nextYear, expMonth);
  const monthPad = String(expMonth).padStart(2, "0");
  const dayPad = String(lastDay).padStart(2, "0");

  return {
    carryoverAmount: Math.round(carryoverAmount * 100) / 100,
    forfeitedAmount,
    expiresAt: `${nextYear}-${monthPad}-${dayPad}`,
  };
}

/**
 * Checks whether carried-over balance has expired according to statutory cutoff date.
 */
export function isCarryoverExpired(
  expiresAt: string,
  currentDate: string,
): boolean {
  return currentDate > expiresAt;
}
