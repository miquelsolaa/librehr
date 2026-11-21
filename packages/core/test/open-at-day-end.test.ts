import { describe, expect, it } from "vitest";
import { openAtDayEnd } from "../src/time/open-at-day-end.js";
import type { TimeEvent } from "../src/time/events.js";

const MADRID = "Europe/Madrid";

function event(
  id: string,
  eventType: TimeEvent["eventType"],
  occurredAt: string,
  extra: { recordedAt?: string; refEventId?: string } = {},
): TimeEvent {
  return {
    id,
    eventType,
    occurredAt,
    recordedAt: extra.recordedAt ?? occurredAt,
    organizationId: "org",
    employeeId: "emp",
    source: "web",
    actorId: "user",
    prevHash: null,
    hash: id,
    ...(extra.refEventId ? { refEventId: extra.refEventId } : {}),
  };
}

describe("openAtDayEnd (TIM-003)", () => {
  it("reports a session left clocked in", () => {
    expect(
      openAtDayEnd(
        [event("a", "clock_in", "2026-11-02T08:00:00Z")],
        "2026-11-02",
        MADRID,
      ),
    ).toEqual({ state: "clocked_in", clockIn: "2026-11-02T08:00:00Z" });
  });

  it("ignores a closed day and a day without events", () => {
    const events = [
      event("a", "clock_in", "2026-11-02T08:00:00Z"),
      event("b", "clock_out", "2026-11-02T16:00:00Z"),
    ];
    expect(openAtDayEnd(events, "2026-11-02", MADRID)).toBeNull();
    expect(openAtDayEnd(events, "2026-11-03", MADRID)).toBeNull();
    expect(openAtDayEnd([], "2026-11-02", MADRID)).toBeNull();
  });

  it("reports a break left open", () => {
    expect(
      openAtDayEnd(
        [
          event("a", "clock_in", "2026-11-02T08:00:00Z"),
          event("b", "break_start", "2026-11-02T12:00:00Z"),
        ],
        "2026-11-02",
        MADRID,
      ),
    ).toEqual({ state: "on_break", clockIn: "2026-11-02T08:00:00Z" });
  });

  it("checks only the last of several sessions", () => {
    const morning = [
      event("a", "clock_in", "2026-11-02T07:00:00Z"),
      event("b", "clock_out", "2026-11-02T11:00:00Z"),
    ];
    expect(
      openAtDayEnd(
        [...morning, event("c", "clock_in", "2026-11-02T15:00:00Z")],
        "2026-11-02",
        MADRID,
      ),
    ).toEqual({ state: "clocked_in", clockIn: "2026-11-02T15:00:00Z" });
    expect(
      openAtDayEnd(
        [
          event("x", "clock_in", "2026-11-02T06:00:00Z"),
          ...morning,
          event("c", "clock_in", "2026-11-02T15:00:00Z"),
          event("d", "clock_out", "2026-11-02T19:00:00Z"),
        ],
        "2026-11-02",
        MADRID,
      ),
    ).toBeNull();
  });

  it("treats a clock-out exactly at the closing local midnight as closing the day", () => {
    // 2026-11-03T00:00 in Madrid (CET) is 2026-11-02T23:00Z.
    const events = [
      event("a", "clock_in", "2026-11-02T17:00:00Z"),
      event("b", "clock_out", "2026-11-02T23:00:00Z"),
    ];
    expect(openAtDayEnd(events, "2026-11-02", MADRID)).toBeNull();
    // The clock-out belongs to the next day, where nothing is left open.
    expect(openAtDayEnd(events, "2026-11-03", MADRID)).toBeNull();
  });

  it("does not count a clock-in at the closing midnight on the day", () => {
    expect(
      openAtDayEnd(
        [event("a", "clock_in", "2026-11-02T23:00:00Z")],
        "2026-11-02",
        MADRID,
      ),
    ).toBeNull();
  });

  it("uses the local day, not the UTC day", () => {
    // 23:30 local on 2 Nov in Madrid is 22:30Z; in Canary time it is 22:30.
    const late = [event("a", "clock_in", "2026-11-02T22:30:00Z")];
    expect(openAtDayEnd(late, "2026-11-02", MADRID)).not.toBeNull();
    expect(openAtDayEnd(late, "2026-11-02", "Atlantic/Canary")).not.toBeNull();
    // 00:30 local on 3 Nov in Madrid: not on 2 Nov there.
    const early = [event("a", "clock_in", "2026-11-02T23:30:00Z")];
    expect(openAtDayEnd(early, "2026-11-02", MADRID)).toBeNull();
    expect(openAtDayEnd(early, "2026-11-02", "Atlantic/Canary")).not.toBeNull();
  });

  it("uses 23- and 25-hour days on DST change days", () => {
    // Spring forward: 29 Mar 2026 ends at 2026-03-29T22:00Z.
    expect(
      openAtDayEnd(
        [event("a", "clock_in", "2026-03-29T21:30:00Z")],
        "2026-03-29",
        MADRID,
      ),
    ).not.toBeNull();
    expect(
      openAtDayEnd(
        [event("a", "clock_in", "2026-03-29T22:00:00Z")],
        "2026-03-29",
        MADRID,
      ),
    ).toBeNull();
    // Fall back: 25 Oct 2026 starts at 2026-10-24T22:00Z, ends at 23:00Z.
    const fallBack = [event("a", "clock_in", "2026-10-25T22:30:00Z")];
    expect(openAtDayEnd(fallBack, "2026-10-25", MADRID)).not.toBeNull();
    expect(
      openAtDayEnd(
        [event("a", "clock_in", "2026-10-24T22:00:00Z")],
        "2026-10-25",
        MADRID,
      ),
    ).not.toBeNull();
  });

  it("applies corrections that reference the originals", () => {
    const clockIn = event("a", "clock_in", "2026-11-02T08:00:00Z");
    const clockOut = event("b", "clock_out", "2026-11-02T16:00:00Z");
    // The clock-out is first moved into the next day, then corrected back
    // into the day: the latest correction wins.
    const moved = event("c", "correction", "2026-11-03T09:00:00Z", {
      recordedAt: "2026-11-03T10:00:00Z",
      refEventId: "b",
    });
    expect(
      openAtDayEnd([clockIn, clockOut, moved], "2026-11-02", MADRID),
    ).toEqual({ state: "clocked_in", clockIn: "2026-11-02T08:00:00Z" });
    const fixed = event("d", "correction", "2026-11-02T17:00:00Z", {
      recordedAt: "2026-11-04T10:00:00Z",
      refEventId: "c",
    });
    expect(
      openAtDayEnd([clockIn, clockOut, moved, fixed], "2026-11-02", MADRID),
    ).toBeNull();
    // A correction turning the clock-out into a break start leaves a break open.
    const asBreak = event("e", "break_start", "2026-11-02T16:00:00Z", {
      recordedAt: "2026-11-02T18:00:00Z",
      refEventId: "b",
    });
    expect(
      openAtDayEnd([clockIn, clockOut, asBreak], "2026-11-02", MADRID),
    ).toEqual({ state: "on_break", clockIn: "2026-11-02T08:00:00Z" });
  });

  it("flags a forgotten clock-out even when the next punch is a clock-out", () => {
    // Forgot to clock out on 2 Nov; the app then only offers a clock-out.
    const events = [
      event("a", "clock_in", "2026-11-02T08:00:00Z"),
      event("b", "clock_out", "2026-11-03T16:00:00Z"),
    ];
    const expected = { state: "clocked_in", clockIn: "2026-11-02T08:00:00Z" };
    expect(openAtDayEnd(events, "2026-11-02", MADRID)).toEqual(expected);
    // Same answer before the next punch exists: independent of run time.
    expect(openAtDayEnd(events.slice(0, 1), "2026-11-02", MADRID)).toEqual(
      expected,
    );
    // The next day only closes the session: nothing left open.
    expect(openAtDayEnd(events, "2026-11-03", MADRID)).toBeNull();
  });

  it("flags a night shift still open at local midnight", () => {
    const events = [
      event("a", "clock_in", "2026-11-02T21:00:00Z"),
      event("b", "clock_out", "2026-11-03T05:00:00Z"),
    ];
    expect(openAtDayEnd(events, "2026-11-02", MADRID)).toEqual({
      state: "clocked_in",
      clockIn: "2026-11-02T21:00:00Z",
    });
  });

  it("flags a session opened the day before when the day's events leave it open", () => {
    expect(
      openAtDayEnd(
        [
          event("a", "clock_in", "2026-11-01T20:00:00Z"),
          event("b", "break_start", "2026-11-02T09:00:00Z"),
        ],
        "2026-11-02",
        MADRID,
      ),
    ).toEqual({ state: "on_break", clockIn: "2026-11-01T20:00:00Z" });
  });
});
