export interface ScheduleRule {
  dayOfWeek: number; // 1 (Monday) to 7 (Sunday)
  expectedHours: number;
  coreStartMinutes?: number | undefined; // e.g. 9:00 = 540
  coreEndMinutes?: number | undefined; // e.g. 17:00 = 1020
  breakMinutes?: number | undefined; // standard unpaid lunch break
}

export interface WorkingTimeSchedule {
  id: string;
  name: string;
  type: "fixed" | "flexible" | "shift";
  weeklyHours: number;
  minimumDailyRestHours: number; // statutory default is 12 hours (ET art. 34.3)
  rules: ScheduleRule[];
}

export interface RestPeriodViolation {
  previousShiftEnd: string;
  nextShiftStart: string;
  actualRestHours: number;
  requiredRestHours: number;
}

/**
 * Validates whether the rest interval between consecutive work days meets
 * the statutory minimum (defaults to 12 consecutive hours per ET art. 34.3).
 */
export function validateRestPeriod(
  previousShiftEnd: string,
  nextShiftStart: string,
  minimumRestHours = 12,
): RestPeriodViolation | null {
  const prev = new Date(previousShiftEnd).getTime();
  const next = new Date(nextShiftStart).getTime();

  if (next <= prev) {
    return null;
  }

  const diffHours = (next - prev) / (1000 * 60 * 60);

  if (diffHours < minimumRestHours) {
    return {
      previousShiftEnd,
      nextShiftStart,
      actualRestHours: Math.round(diffHours * 10) / 10,
      requiredRestHours: minimumRestHours,
    };
  }

  return null;
}
