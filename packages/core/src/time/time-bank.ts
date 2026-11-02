export type TimeBankEntryType =
  | "overtime_accrual"
  | "compensatory_rest_taken"
  | "manual_adjustment"
  | "expired";

export interface TimeBankEntry {
  type: TimeBankEntryType;
  minutes: number;
  referenceDate: string; // YYYY-MM-DD
}

export interface TimeBankCalculationResult {
  totalAccruedMinutes: number;
  totalCompensatedMinutes: number;
  currentBalanceMinutes: number;
  currentBalanceHoursFormatted: string; // e.g. "+12h 30m", "-2h 00m", "0h 00m"
}

/**
 * Pure calculation of an employee's time bank / bolsa de horas balance (TIM-012)
 * in compliance with Spanish labor agreements (Estatuto de los Trabajadores art. 35).
 */
export function calculateTimeBankBalance(
  entries: readonly TimeBankEntry[],
): TimeBankCalculationResult {
  let totalAccrued = 0;
  let totalCompensated = 0;
  let balance = 0;

  for (const entry of entries) {
    switch (entry.type) {
      case "overtime_accrual": {
        const mins = Math.max(0, entry.minutes);
        totalAccrued += mins;
        balance += mins;
        break;
      }
      case "compensatory_rest_taken": {
        const mins = Math.abs(entry.minutes);
        totalCompensated += mins;
        balance -= mins;
        break;
      }
      case "manual_adjustment": {
        balance += entry.minutes;
        if (entry.minutes > 0) {
          totalAccrued += entry.minutes;
        } else {
          totalCompensated += Math.abs(entry.minutes);
        }
        break;
      }
      case "expired": {
        balance -= Math.abs(entry.minutes);
        break;
      }
    }
  }

  const sign = balance < 0 ? "-" : balance > 0 ? "+" : "";
  const absMin = Math.abs(balance);
  const hours = Math.floor(absMin / 60);
  const mins = absMin % 60;
  const currentBalanceHoursFormatted = `${sign}${hours}h ${mins.toString().padStart(2, "0")}m`;

  return {
    totalAccruedMinutes: totalAccrued,
    totalCompensatedMinutes: totalCompensated,
    currentBalanceMinutes: balance,
    currentBalanceHoursFormatted,
  };
}
