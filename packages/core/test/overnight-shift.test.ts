import { describe, expect, it } from "vitest";
import {
  coveredByOvernightShift,
  shiftRunsPastMidnight,
  type ScheduledShift,
} from "../src/time/overnight-shift.js";

const MADRID = "Europe/Madrid";
const NIGHT: ScheduledShift = {
  type: "night",
  startTime: "22:00",
  endTime: "06:00",
};

const shift = (
  startTime: string,
  endTime: string,
  type = "morning",
): ScheduledShift => ({ type, startTime, endTime });

describe("shiftRunsPastMidnight (TIM-003)", () => {
  it("is true for a shift ending the next day", () => {
    expect(shiftRunsPastMidnight(NIGHT)).toBe(true);
    expect(shiftRunsPastMidnight(shift("18:00", "00:01"))).toBe(true);
  });

  it("is true for a 24-hour shift (end equals start)", () => {
    expect(shiftRunsPastMidnight(shift("08:00", "08:00"))).toBe(true);
  });

  it("is false for a shift within the day or ending exactly at midnight", () => {
    expect(shiftRunsPastMidnight(shift("06:00", "14:00"))).toBe(false);
    expect(shiftRunsPastMidnight(shift("14:00", "00:00"))).toBe(false);
    expect(shiftRunsPastMidnight(shift("00:00", "00:00"))).toBe(false);
    expect(shiftRunsPastMidnight(shift("00:00", "08:00"))).toBe(false);
  });

  it("never counts a rest day", () => {
    expect(shiftRunsPastMidnight(shift("22:00", "06:00", "rest"))).toBe(false);
  });

  it("falls back to false on malformed times", () => {
    expect(shiftRunsPastMidnight(shift("22:00", "99:99"))).toBe(false);
    expect(shiftRunsPastMidnight(shift("25:00", "06:00"))).toBe(false);
    expect(shiftRunsPastMidnight(shift("22:00", "6:00"))).toBe(false);
    expect(shiftRunsPastMidnight(shift("", ""))).toBe(false);
  });
});

describe("coveredByOvernightShift (TIM-003)", () => {
  // 22:00 local on 2 Nov 2026 (CET, UTC+1).
  const nightStart = {
    state: "clocked_in",
    clockIn: "2026-11-02T21:00:00Z",
  } as const;

  it("covers a session opened on the day of a rostered night shift", () => {
    expect(
      coveredByOvernightShift(nightStart, "2026-11-02", MADRID, NIGHT),
    ).toBe(true);
    expect(
      coveredByOvernightShift(
        { state: "on_break", clockIn: "2026-11-02T21:00:00Z" },
        "2026-11-02",
        MADRID,
        NIGHT,
      ),
    ).toBe(true);
  });

  it("does not cover a day without a shift or with a day shift", () => {
    expect(
      coveredByOvernightShift(nightStart, "2026-11-02", MADRID, null),
    ).toBe(false);
    expect(
      coveredByOvernightShift(
        nightStart,
        "2026-11-02",
        MADRID,
        shift("14:00", "22:00", "afternoon"),
      ),
    ).toBe(false);
  });

  it("does not cover a session carried over from the previous day", () => {
    // Clocked in for the 1 Nov night shift and never clocked out: on 2 Nov,
    // also a night shift, the reminder still goes out.
    expect(
      coveredByOvernightShift(
        { state: "clocked_in", clockIn: "2026-11-01T21:00:00Z" },
        "2026-11-02",
        MADRID,
        NIGHT,
      ),
    ).toBe(false);
  });

  it("uses the local day start, not the UTC one", () => {
    // 00:30 local on 2 Nov is 23:30 UTC on 1 Nov: still on the local day.
    expect(
      coveredByOvernightShift(
        { state: "clocked_in", clockIn: "2026-11-01T23:30:00Z" },
        "2026-11-02",
        MADRID,
        NIGHT,
      ),
    ).toBe(true);
    // One minute before local midnight belongs to the day before.
    expect(
      coveredByOvernightShift(
        { state: "clocked_in", clockIn: "2026-11-01T22:59:00Z" },
        "2026-11-02",
        MADRID,
        NIGHT,
      ),
    ).toBe(false);
  });

  it("handles DST change days", () => {
    // 25 Oct 2026: clocks go back, local midnight is 22:00 UTC the day before.
    expect(
      coveredByOvernightShift(
        { state: "clocked_in", clockIn: "2026-10-24T22:00:00Z" },
        "2026-10-25",
        MADRID,
        NIGHT,
      ),
    ).toBe(true);
    // 29 Mar 2026: clocks go forward, local midnight is 23:00 UTC.
    expect(
      coveredByOvernightShift(
        { state: "clocked_in", clockIn: "2026-03-28T22:30:00Z" },
        "2026-03-29",
        MADRID,
        NIGHT,
      ),
    ).toBe(false);
    expect(
      coveredByOvernightShift(
        { state: "clocked_in", clockIn: "2026-03-29T20:00:00Z" },
        "2026-03-29",
        MADRID,
        NIGHT,
      ),
    ).toBe(true);
  });
});
