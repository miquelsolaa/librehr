import { describe, expect, it } from "vitest";
import { foldSessions } from "../src/time/fold-sessions.js";
import type { TimeEvent } from "../src/time/events.js";

function event(
  id: string,
  eventType: TimeEvent["eventType"],
  occurredAt: string,
  recordedAt: string,
  refEventId?: string,
): TimeEvent {
  return {
    id,
    eventType,
    occurredAt,
    recordedAt,
    organizationId: "org",
    employeeId: "emp",
    source: "manual",
    actorId: "user",
    prevHash: null,
    hash: id,
    ...(refEventId ? { refEventId } : {}),
  };
}
const start = event(
  "start",
  "clock_in",
  "2026-11-02T08:00:00Z",
  "2026-11-02T08:00:00Z",
);
const end = event(
  "end",
  "clock_out",
  "2026-11-02T16:00:00Z",
  "2026-11-02T16:00:00Z",
);

describe("approved corrections in timesheets", () => {
  it("replaces an original clock-out without double counting", () => {
    const correction = event(
      "fix",
      "clock_out",
      "2026-11-02T17:00:00Z",
      "2026-11-03T08:00:00Z",
      "end",
    );
    expect(
      foldSessions([start, end, correction])[0]?.netWorkedDurationMinutes,
    ).toBe(540);
  });
  it("uses the latest recorded correction for a correction chain", () => {
    const first = event(
      "fix1",
      "clock_out",
      "2026-11-02T17:00:00Z",
      "2026-11-03T08:00:00Z",
      "end",
    );
    const second = event(
      "fix2",
      "correction",
      "2026-11-02T18:00:00Z",
      "2026-11-04T08:00:00Z",
      "fix1",
    );
    expect(
      foldSessions([second, end, first, start])[0]?.netWorkedDurationMinutes,
    ).toBe(600);
  });
  it("uses recording order when two corrections reference the same event", () => {
    const older = event(
      "older",
      "clock_out",
      "2026-11-02T19:00:00Z",
      "2026-11-03T08:00:00Z",
      "end",
    );
    const newer = event(
      "newer",
      "clock_out",
      "2026-11-02T17:00:00Z",
      "2026-11-04T08:00:00Z",
      "end",
    );
    expect(
      foldSessions([start, newer, end, older])[0]?.netWorkedDurationMinutes,
    ).toBe(540);
  });
  it("keeps unreferenced manual clock-outs as added events", () => {
    const added = event(
      "added",
      "clock_out",
      "2026-11-02T17:00:00Z",
      "2026-11-03T08:00:00Z",
    );
    expect(foldSessions([start, added])[0]?.netWorkedDurationMinutes).toBe(540);
  });
  it("rejects corrections with missing or foreign references", () => {
    const missing = event(
      "bad",
      "clock_out",
      "2026-11-02T17:00:00Z",
      "2026-11-03T08:00:00Z",
      "unknown",
    );
    expect(() => foldSessions([start, end, missing])).toThrow();
    const foreign = { ...end, employeeId: "another" };
    const correction = event(
      "fix",
      "clock_out",
      "2026-11-02T17:00:00Z",
      "2026-11-03T08:00:00Z",
      "end",
    );
    expect(() => foldSessions([start, foreign, correction])).toThrow();
    const first = event(
      "first",
      "correction",
      "2026-11-02T17:00:00Z",
      "2026-11-03T08:00:00Z",
      "second",
    );
    const second = event(
      "second",
      "correction",
      "2026-11-02T18:00:00Z",
      "2026-11-03T08:00:00Z",
      "first",
    );
    expect(() => foldSessions([first, second])).toThrow();
  });
});
