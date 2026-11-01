import { Temporal } from "temporal-polyfill";

export interface WorkingDaysOptions {
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  holidays?: ReadonlySet<string> | string[] | undefined; // YYYY-MM-DD set or array
  workingDaysOfWeek?: readonly number[] | undefined; // 1 (Monday) to 7 (Sunday), default: [1, 2, 3, 4, 5]
  halfDayStart?: boolean | undefined;
  halfDayEnd?: boolean | undefined;
}

export interface WorkingDaysResult {
  totalCalendarDays: number;
  totalWorkingDays: number;
  breakdown: {
    workingDays: string[];
    weekendDays: string[];
    holidayDays: string[];
  };
}

/**
 * Computes working days between two ISO dates using pure Temporal API arithmetic.
 * Never performs Date object arithmetic.
 */
export function calculateWorkingDays(
  options: WorkingDaysOptions,
): WorkingDaysResult {
  const start = Temporal.PlainDate.from(options.startDate);
  const end = Temporal.PlainDate.from(options.endDate);

  if (Temporal.PlainDate.compare(start, end) > 0) {
    throw new Error(
      `startDate (${options.startDate}) must be on or before endDate (${options.endDate})`,
    );
  }

  const holidaySet =
    options.holidays instanceof Set
      ? options.holidays
      : new Set(options.holidays ?? []);

  const standardWorkingDays = new Set(
    options.workingDaysOfWeek ?? [1, 2, 3, 4, 5],
  );

  const workingDays: string[] = [];
  const weekendDays: string[] = [];
  const holidayDays: string[] = [];

  let current = start;
  let rawWorkingCount = 0;
  let totalCalendarDays = 0;

  while (Temporal.PlainDate.compare(current, end) <= 0) {
    totalCalendarDays++;
    const dateStr = current.toString();
    const dayOfWeek = current.dayOfWeek;

    if (holidaySet.has(dateStr)) {
      holidayDays.push(dateStr);
    } else if (!standardWorkingDays.has(dayOfWeek)) {
      weekendDays.push(dateStr);
    } else {
      workingDays.push(dateStr);
      rawWorkingCount++;
    }

    current = current.add({ days: 1 });
  }

  // Adjust for half days if the start/end date falls on an eligible working day
  let deduction = 0;

  if (options.halfDayStart && workingDays.includes(options.startDate)) {
    deduction += 0.5;
  }

  // If start date and end date are the same day, don't double-deduct
  if (
    options.startDate !== options.endDate &&
    options.halfDayEnd &&
    workingDays.includes(options.endDate)
  ) {
    deduction += 0.5;
  }

  const totalWorkingDays = Math.max(0, rawWorkingCount - deduction);

  return {
    totalCalendarDays,
    totalWorkingDays,
    breakdown: {
      workingDays,
      weekendDays,
      holidayDays,
    },
  };
}
