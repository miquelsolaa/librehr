import { describe, expect, it } from "vitest";
import { splitSessionsByLocalDay } from "../src/time/local-day-sessions.js";
import type { WorkSession } from "../src/time/fold-sessions.js";

const session: WorkSession = {
  clockIn: "2026-11-02T22:00:00Z",
  clockOut: "2026-11-03T02:00:00Z",
  isOpen: false,
  breaks: [
    {
      breakStart: "2026-11-02T22:30:00Z",
      breakEnd: "2026-11-02T23:30:00Z",
      durationMinutes: 60,
    },
  ],
  grossDurationMinutes: 240,
  totalBreakMinutes: 60,
  netWorkedDurationMinutes: 180,
};

describe("local calendar day sessions", () => {
  it("splits work and breaks at local midnight, including a session starting outside the requested period", () => {
    const days = splitSessionsByLocalDay(
      [session],
      "2026-11-02",
      "2026-11-03",
      "Europe/Madrid",
    );
    expect(days.get("2026-11-02")?.[0]).toMatchObject({
      grossDurationMinutes: 60,
      totalBreakMinutes: 30,
      netWorkedDurationMinutes: 30,
    });
    expect(days.get("2026-11-03")?.[0]).toMatchObject({
      grossDurationMinutes: 180,
      totalBreakMinutes: 30,
      netWorkedDurationMinutes: 150,
    });
  });
  it("uses actual elapsed time on a daylight saving transition", () => {
    const dst: WorkSession = {
      clockIn: "2026-03-28T23:00:00Z",
      clockOut: "2026-03-29T22:00:00Z",
      isOpen: false,
      breaks: [],
      grossDurationMinutes: 1380,
      totalBreakMinutes: 0,
      netWorkedDurationMinutes: 1380,
    };
    expect(
      splitSessionsByLocalDay(
        [dst],
        "2026-03-29",
        "2026-03-29",
        "Europe/Madrid",
      ).get("2026-03-29")?.[0]?.grossDurationMinutes,
    ).toBe(1380);
  });
  it("marks an open session crossing the period as an anomaly", () => {
    const open: WorkSession = {
      clockIn: "2026-11-02T22:00:00Z",
      isOpen: true,
      breaks: [],
      grossDurationMinutes: 0,
      totalBreakMinutes: 0,
      netWorkedDurationMinutes: 0,
    };
    expect(
      splitSessionsByLocalDay(
        [open],
        "2026-11-03",
        "2026-11-03",
        "Europe/Madrid",
      ).get("2026-11-03")?.[0]?.isOpen,
    ).toBe(true);
  });
});
