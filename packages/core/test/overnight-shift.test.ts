import { describe, expect, it } from "vitest";
import {
  coveredByOvernightShift,
  overnightStillOpenAtDayEnd,
  shiftRunsPastMidnight,
  type ScheduledShift,
} from "../src/time/overnight-shift.js";
import type { TimeEvent } from "../src/time/events.js";

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

const openSince = (clockIn: string) =>
  ({ state: "clocked_in", clockIn }) as const;

function event(
  id: string,
  eventType: TimeEvent["eventType"],
  occurredAt: string,
): TimeEvent {
  return {
    id,
    eventType,
    occurredAt,
    recordedAt: occurredAt,
    organizationId: "org",
    employeeId: "emp",
    source: "web",
    actorId: "user",
    prevHash: null,
    hash: id,
  };
}

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
  const nightStart = openSince("2026-11-02T21:00:00Z");

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
        openSince("2026-11-01T21:00:00Z"),
        "2026-11-02",
        MADRID,
        NIGHT,
      ),
    ).toBe(false);
  });

  it("covers only clock-ins from the shift's end time on, in local time", () => {
    // 00:30 local on 2 Nov belongs to the 1 Nov night shift.
    expect(
      coveredByOvernightShift(
        openSince("2026-11-01T23:30:00Z"),
        "2026-11-02",
        MADRID,
        NIGHT,
      ),
    ).toBe(false);
    // 05:59 and 06:00 local (CET).
    expect(
      coveredByOvernightShift(
        openSince("2026-11-02T04:59:00Z"),
        "2026-11-02",
        MADRID,
        NIGHT,
      ),
    ).toBe(false);
    expect(
      coveredByOvernightShift(
        openSince("2026-11-02T05:00:00Z"),
        "2026-11-02",
        MADRID,
        NIGHT,
      ),
    ).toBe(true);
  });

  it("handles DST change days", () => {
    // 25 Oct 2026: clocks go back at 03:00, so 06:00 local is 05:00 UTC.
    expect(
      coveredByOvernightShift(
        openSince("2026-10-25T04:59:00Z"),
        "2026-10-25",
        MADRID,
        NIGHT,
      ),
    ).toBe(false);
    expect(
      coveredByOvernightShift(
        openSince("2026-10-25T05:00:00Z"),
        "2026-10-25",
        MADRID,
        NIGHT,
      ),
    ).toBe(true);
    // 29 Mar 2026: clocks go forward at 02:00, so 06:00 local is 04:00 UTC.
    expect(
      coveredByOvernightShift(
        openSince("2026-03-29T03:59:00Z"),
        "2026-03-29",
        MADRID,
        NIGHT,
      ),
    ).toBe(false);
    expect(
      coveredByOvernightShift(
        openSince("2026-03-29T20:00:00Z"),
        "2026-03-29",
        MADRID,
        NIGHT,
      ),
    ).toBe(true);
  });
});

describe("overnightStillOpenAtDayEnd (TIM-003)", () => {
  const clockIn = event("a", "clock_in", "2026-11-02T21:00:00Z");

  it("reports a night shift never clocked out, without events on the day", () => {
    expect(
      overnightStillOpenAtDayEnd([clockIn], "2026-11-03", MADRID, NIGHT),
    ).toEqual({ state: "clocked_in", clockIn: "2026-11-02T21:00:00Z" });
  });

  it("is quiet once the shift was clocked out", () => {
    expect(
      overnightStillOpenAtDayEnd(
        [clockIn, event("b", "clock_out", "2026-11-03T05:00:00Z")],
        "2026-11-03",
        MADRID,
        NIGHT,
      ),
    ).toBeNull();
  });

  it("needs the previous day's shift to run past midnight", () => {
    expect(
      overnightStillOpenAtDayEnd([clockIn], "2026-11-03", MADRID, null),
    ).toBeNull();
    expect(
      overnightStillOpenAtDayEnd(
        [clockIn],
        "2026-11-03",
        MADRID,
        shift("14:00", "22:00", "afternoon"),
      ),
    ).toBeNull();
  });

  it("ignores a session the previous day's shift did not cover", () => {
    // Opened on 1 Nov: the 1 Nov run reported it, and 2 Nov's run too if it
    // had events that day.
    expect(
      overnightStillOpenAtDayEnd(
        [event("x", "clock_in", "2026-11-01T21:00:00Z")],
        "2026-11-03",
        MADRID,
        NIGHT,
      ),
    ).toBeNull();
  });
});
