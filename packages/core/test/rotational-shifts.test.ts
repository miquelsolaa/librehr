import { describe, it, expect } from "vitest";
import {
  calculateNightHours,
  resolveShiftForDate,
  generateRotationalRoster,
  validateShiftRestPeriods,
  CANONICAL_SHIFTS,
  CONTINUOUS_6X2_PATTERN,
} from "../src/index.js";

describe("Rotational Shifts & Continuous Cycle Systems (TIM-004, TIM-005)", () => {
  it("calculates statutory night hours under Spanish labor law (ET art. 36)", () => {
    // Standard night shift: 22:00 to 06:00 (8h = 480m all night)
    const nightShift = calculateNightHours("22:00", "06:00");
    expect(nightShift.totalMinutes).toBe(480);
    expect(nightShift.nightMinutes).toBe(480);
    expect(nightShift.dayMinutes).toBe(0);

    // Standard day shift: 08:00 to 16:00 (8h = 480m all day)
    const dayShift = calculateNightHours("08:00", "16:00");
    expect(dayShift.totalMinutes).toBe(480);
    expect(dayShift.nightMinutes).toBe(0);
    expect(dayShift.dayMinutes).toBe(480);

    // Mixed evening shift: 18:00 to 02:00 (8h: 4h day 18-22, 4h night 22-02)
    const eveningShift = calculateNightHours("18:00", "02:00");
    expect(eveningShift.totalMinutes).toBe(480);
    expect(eveningShift.nightMinutes).toBe(240); // 4 hours
    expect(eveningShift.dayMinutes).toBe(240); // 4 hours

    // Early morning shift: 04:00 to 12:00 (8h: 2h night 04-06, 6h day 06-12)
    const earlyShift = calculateNightHours("04:00", "12:00");
    expect(earlyShift.totalMinutes).toBe(480);
    expect(earlyShift.nightMinutes).toBe(120); // 2 hours
    expect(earlyShift.dayMinutes).toBe(360); // 6 hours
  });

  it("resolves rotational shift for dates in continuous 6x2 cycle", () => {
    // Anchor: 2026-11-01 is Day 0 (M)
    const anchor = "2026-11-01";

    // Day 0: M
    const d0 = resolveShiftForDate(
      CONTINUOUS_6X2_PATTERN,
      anchor,
      "2026-11-01",
      CANONICAL_SHIFTS,
    );
    expect(d0?.code).toBe("M");

    // Day 1: M
    const d1 = resolveShiftForDate(
      CONTINUOUS_6X2_PATTERN,
      anchor,
      "2026-11-02",
      CANONICAL_SHIFTS,
    );
    expect(d1?.code).toBe("M");

    // Day 2: T
    const d2 = resolveShiftForDate(
      CONTINUOUS_6X2_PATTERN,
      anchor,
      "2026-11-03",
      CANONICAL_SHIFTS,
    );
    expect(d2?.code).toBe("T");

    // Day 4: N
    const d4 = resolveShiftForDate(
      CONTINUOUS_6X2_PATTERN,
      anchor,
      "2026-11-05",
      CANONICAL_SHIFTS,
    );
    expect(d4?.code).toBe("N");

    // Day 6: OFF
    const d6 = resolveShiftForDate(
      CONTINUOUS_6X2_PATTERN,
      anchor,
      "2026-11-07",
      CANONICAL_SHIFTS,
    );
    expect(d6).toBeNull();

    // Day 8 (Cycle repeats): M
    const d8 = resolveShiftForDate(
      CONTINUOUS_6X2_PATTERN,
      anchor,
      "2026-11-09",
      CANONICAL_SHIFTS,
    );
    expect(d8?.code).toBe("M");
  });

  it("generates a complete multi-week shift roster", () => {
    const roster = generateRotationalRoster({
      pattern: CONTINUOUS_6X2_PATTERN,
      anchorDate: "2026-11-01",
      startDate: "2026-11-01",
      endDate: "2026-11-08",
      shiftDefinitions: CANONICAL_SHIFTS,
    });

    expect(roster.length).toBe(8);
    const codes = roster.map((r) => r.shiftCode);
    expect(codes).toEqual(["M", "M", "T", "T", "N", "N", "OFF", "OFF"]);
  });

  it("detects statutory 12-hour minimum rest period violations (ET art. 34.3)", () => {
    // Afternoon shift (14:00 - 22:00) followed next day by Morning shift (06:00 - 14:00)
    // End 22:00 -> Start 06:00 = 8h rest (< 12h required!)
    const invalidSequence = [
      { date: "2026-11-01", startTime: "14:00", endTime: "22:00" },
      { date: "2026-11-02", startTime: "06:00", endTime: "14:00" },
    ];

    const violations = validateShiftRestPeriods(invalidSequence, 12);
    expect(violations.length).toBe(1);
    expect(violations[0]?.actualRestHours).toBe(8);
    expect(violations[0]?.requiredRestHours).toBe(12);

    // Morning shift (06:00 - 14:00) followed next day by Afternoon shift (14:00 - 22:00)
    // End 14:00 -> Start 14:00 = 24h rest (compliant!)
    const validSequence = [
      { date: "2026-11-01", startTime: "06:00", endTime: "14:00" },
      { date: "2026-11-02", startTime: "14:00", endTime: "22:00" },
    ];

    const noViolations = validateShiftRestPeriods(validSequence, 12);
    expect(noViolations.length).toBe(0);
  });
});
