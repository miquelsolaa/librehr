import { Temporal } from "temporal-polyfill";

export type ShiftType = "morning" | "afternoon" | "night" | "rest";

export interface ShiftDefinition {
  id: string;
  name: string;
  code: string; // e.g. "M", "T", "N", "OFF"
  type: ShiftType;
  startTime: string; // "HH:mm", e.g. "06:00", "14:00", "22:00"
  endTime: string; // "HH:mm", e.g. "14:00", "22:00", "06:00"
  color: string;
  breakMinutes: number;
}

export interface RotationalStep {
  stepOrder: number; // 0, 1, 2, ...
  shiftCode: string; // References ShiftDefinition.code, or "OFF" for rest day
  isRest: boolean;
}

export interface RotationalPattern {
  id: string;
  name: string; // e.g. "Continuous 6x2 (M-M-T-T-N-N-D-D)", "Rotating 3 Shifts (5x2)"
  cycleDays: number; // Length of cycle in days (e.g. 8 for 6x2)
  steps: RotationalStep[];
}

export interface NightHoursResult {
  totalMinutes: number;
  nightMinutes: number; // Hours between 22:00 and 06:00 (ET art. 36)
  dayMinutes: number;
}

/**
 * Parses "HH:mm" into minutes from start of day (0 to 1439).
 */
export function parseTimeToMinutes(timeStr: string): number {
  const parts = timeStr.split(":");
  const hours = parseInt(parts[0] ?? "0", 10);
  const minutes = parseInt(parts[1] ?? "0", 10);
  return hours * 60 + minutes;
}

/**
 * Computes statutory night hours under Spanish labor law (Estatuto de los Trabajadores art. 36.1).
 * Night period is strictly from 22:00 (1320m) to 06:00 (360m).
 *
 * @param startTime "HH:mm" (e.g. "22:00", "18:00")
 * @param endTime "HH:mm" (e.g. "06:00", "02:00")
 */
export function calculateNightHours(
  startTime: string,
  endTime: string,
): NightHoursResult {
  const startMins = parseTimeToMinutes(startTime);
  let endMins = parseTimeToMinutes(endTime);

  // If shift crosses midnight (e.g. 22:00 to 06:00)
  if (endMins <= startMins) {
    endMins += 24 * 60;
  }

  const totalMinutes = endMins - startMins;
  let nightMinutes = 0;

  // Iterate in 1-minute or 15-minute intervals (or minute-by-minute)
  for (let m = startMins; m < endMins; m++) {
    const modMinute = m % (24 * 60);
    // Night is between 22:00 (1320m) and 06:00 (360m)
    if (modMinute >= 22 * 60 || modMinute < 6 * 60) {
      nightMinutes++;
    }
  }

  const dayMinutes = totalMinutes - nightMinutes;

  return {
    totalMinutes,
    nightMinutes,
    dayMinutes,
  };
}

/**
 * Resolves the shift assigned to a date in a continuous rotational pattern.
 * Given an anchor date where step 0 begins, computes the target date's shift.
 *
 * @param pattern The rotational shift pattern
 * @param anchorDate YYYY-MM-DD
 * @param targetDate YYYY-MM-DD
 */
export function resolveShiftForDate(
  pattern: RotationalPattern,
  anchorDate: string,
  targetDate: string,
  shiftDefinitions: Record<string, ShiftDefinition>,
): ShiftDefinition | null {
  if (pattern.cycleDays <= 0 || pattern.steps.length === 0) {
    return null;
  }

  const anchor = Temporal.PlainDate.from(anchorDate);
  const target = Temporal.PlainDate.from(targetDate);

  // Calculate day difference
  const diffDays = anchor.until(target).total({ unit: "day" });
  let offset = Math.round(diffDays) % pattern.cycleDays;
  if (offset < 0) {
    offset = (offset + pattern.cycleDays) % pattern.cycleDays;
  }

  const step = pattern.steps.find((s) => s.stepOrder === offset);
  if (!step || step.isRest || step.shiftCode === "OFF") {
    return null;
  }

  return shiftDefinitions[step.shiftCode] ?? null;
}

/**
 * Generates the full roster of shifts for a date range based on a rotational pattern.
 */
export function generateRotationalRoster(params: {
  pattern: RotationalPattern;
  anchorDate: string;
  startDate: string;
  endDate: string;
  shiftDefinitions: Record<string, ShiftDefinition>;
}): Array<{
  date: string;
  shiftCode: string;
  shift: ShiftDefinition | null;
  isRest: boolean;
}> {
  const { pattern, anchorDate, startDate, endDate, shiftDefinitions } = params;
  const start = Temporal.PlainDate.from(startDate);
  const end = Temporal.PlainDate.from(endDate);

  const roster: Array<{
    date: string;
    shiftCode: string;
    shift: ShiftDefinition | null;
    isRest: boolean;
  }> = [];

  let current = start;
  while (Temporal.PlainDate.compare(current, end) <= 0) {
    const dateStr = current.toString();
    const shift = resolveShiftForDate(
      pattern,
      anchorDate,
      dateStr,
      shiftDefinitions,
    );
    roster.push({
      date: dateStr,
      shiftCode: shift ? shift.code : "OFF",
      shift,
      isRest: shift === null,
    });
    current = current.add({ days: 1 });
  }

  return roster;
}

export interface ShiftSequenceItem {
  date: string; // YYYY-MM-DD
  startTime?: string | undefined; // "HH:mm"
  endTime?: string | undefined; // "HH:mm"
  isRest?: boolean | undefined;
}

export interface ShiftRestViolation {
  date: string;
  previousShiftEnd: string;
  nextShiftStart: string;
  actualRestHours: number;
  requiredRestHours: number;
  reason: string;
}

/**
 * Validates statutory daily rest periods (Estatuto de los Trabajadores art. 34.3).
 * Requires minimum 12 consecutive hours between the end of one shift and the start of the next.
 */
export function validateShiftRestPeriods(
  shifts: ShiftSequenceItem[],
  minimumDailyRestHours = 12,
): ShiftRestViolation[] {
  const violations: ShiftRestViolation[] = [];
  const sorted = [...shifts].sort((a, b) => a.date.localeCompare(b.date));

  for (let i = 0; i < sorted.length - 1; i++) {
    const current = sorted[i]!;
    const next = sorted[i + 1]!;

    if (current.isRest || !current.endTime || next.isRest || !next.startTime) {
      continue;
    }

    const currentEndMins = parseTimeToMinutes(current.endTime);
    const nextStartMins = parseTimeToMinutes(next.startTime);

    // Calculate elapsed hours from current end to next start
    // Current date end instant:
    let restMinutes = 24 * 60 - currentEndMins + nextStartMins;

    // If next day is more than 1 day apart, rest is plentiful
    const currDate = Temporal.PlainDate.from(current.date);
    const nextDate = Temporal.PlainDate.from(next.date);
    const dayDiff = Math.round(currDate.until(nextDate).total({ unit: "day" }));

    if (dayDiff > 1) {
      restMinutes += (dayDiff - 1) * 24 * 60;
    }

    const restHours = restMinutes / 60;

    if (restHours < minimumDailyRestHours) {
      violations.push({
        date: next.date,
        previousShiftEnd: `${current.date}T${current.endTime}:00`,
        nextShiftStart: `${next.date}T${next.startTime}:00`,
        actualRestHours: Math.round(restHours * 10) / 10,
        requiredRestHours: minimumDailyRestHours,
        reason: `Insufficient rest period between shifts: ${Math.round(restHours * 10) / 10}h < ${minimumDailyRestHours}h required (ET art. 34.3)`,
      });
    }
  }

  return violations;
}

/**
 * Canonical predefined shift templates used in 24/7 continuous cycles and industry rosters.
 */
export const CANONICAL_SHIFTS: Record<string, ShiftDefinition> = {
  M: {
    id: "shift-morning",
    name: "Morning (Matí / Mañana)",
    code: "M",
    type: "morning",
    startTime: "06:00",
    endTime: "14:00",
    color: "#f59e0b", // Amber
    breakMinutes: 30,
  },
  T: {
    id: "shift-afternoon",
    name: "Afternoon (Tarda / Tarde)",
    code: "T",
    type: "afternoon",
    startTime: "14:00",
    endTime: "22:00",
    color: "#3b82f6", // Blue
    breakMinutes: 30,
  },
  N: {
    id: "shift-night",
    name: "Night (Nit / Noche)",
    code: "N",
    type: "night",
    startTime: "22:00",
    endTime: "06:00",
    color: "#6366f1", // Indigo
    breakMinutes: 30,
  },
  OFF: {
    id: "shift-rest",
    name: "Rest (Descans / Descanso)",
    code: "OFF",
    type: "rest",
    startTime: "00:00",
    endTime: "00:00",
    color: "#94a3b8", // Slate
    breakMinutes: 0,
  },
};

/**
 * Canonical 6x2 continuous rotation cycle: 2 Morning, 2 Afternoon, 2 Night, 2 Rest.
 */
export const CONTINUOUS_6X2_PATTERN: RotationalPattern = {
  id: "pattern-6x2",
  name: "Continuous 6x2 (M-M-T-T-N-N-D-D)",
  cycleDays: 8,
  steps: [
    { stepOrder: 0, shiftCode: "M", isRest: false },
    { stepOrder: 1, shiftCode: "M", isRest: false },
    { stepOrder: 2, shiftCode: "T", isRest: false },
    { stepOrder: 3, shiftCode: "T", isRest: false },
    { stepOrder: 4, shiftCode: "N", isRest: false },
    { stepOrder: 5, shiftCode: "N", isRest: false },
    { stepOrder: 6, shiftCode: "OFF", isRest: true },
    { stepOrder: 7, shiftCode: "OFF", isRest: true },
  ],
};
