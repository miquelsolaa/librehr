import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { foldSessions } from "../src/time/fold-sessions.js";
import type { TimeEvent } from "../src/time/events.js";

describe("Time Domain Logic", () => {
  describe("foldSessions", () => {
    it("folds normal workday with lunch break into accurate session duration", () => {
      const events: TimeEvent[] = [
        {
          id: "1",
          organizationId: "org1",
          employeeId: "emp1",
          eventType: "clock_in",
          occurredAt: "2026-11-02T08:00:00.000Z",
          recordedAt: "2026-11-02T08:00:01.000Z",
          source: "web",
          actorId: "emp1",
          prevHash: null,
          hash: "hash1",
        },
        {
          id: "2",
          organizationId: "org1",
          employeeId: "emp1",
          eventType: "break_start",
          occurredAt: "2026-11-02T13:00:00.000Z",
          recordedAt: "2026-11-02T13:00:01.000Z",
          source: "web",
          actorId: "emp1",
          prevHash: "hash1",
          hash: "hash2",
        },
        {
          id: "3",
          organizationId: "org1",
          employeeId: "emp1",
          eventType: "break_end",
          occurredAt: "2026-11-02T14:00:00.000Z", // 60 min break
          recordedAt: "2026-11-02T14:00:01.000Z",
          source: "web",
          actorId: "emp1",
          prevHash: "hash2",
          hash: "hash3",
        },
        {
          id: "4",
          organizationId: "org1",
          employeeId: "emp1",
          eventType: "clock_out",
          occurredAt: "2026-11-02T17:00:00.000Z", // 9h gross (540 min)
          recordedAt: "2026-11-02T17:00:01.000Z",
          source: "web",
          actorId: "emp1",
          prevHash: "hash3",
          hash: "hash4",
        },
      ];

      const sessions = foldSessions(events);
      expect(sessions.length).toBe(1);
      const session = sessions[0]!;
      expect(session.isOpen).toBe(false);
      expect(session.grossDurationMinutes).toBe(540); // 9h
      expect(session.totalBreakMinutes).toBe(60); // 1h
      expect(session.netWorkedDurationMinutes).toBe(480); // 8h
    });

    it("handles ongoing open session", () => {
      const events: TimeEvent[] = [
        {
          id: "1",
          organizationId: "org1",
          employeeId: "emp1",
          eventType: "clock_in",
          occurredAt: "2026-11-02T08:00:00.000Z",
          recordedAt: "2026-11-02T08:00:01.000Z",
          source: "web",
          actorId: "emp1",
          prevHash: null,
          hash: "hash1",
        },
      ];

      const sessions = foldSessions(events);
      expect(sessions.length).toBe(1);
      expect(sessions[0]?.isOpen).toBe(true);
      expect(sessions[0]?.clockOut).toBeUndefined();
    });

    it("implicitly closes open session on new clock-in and handles unclosed break at clock-out", () => {
      const events: TimeEvent[] = [
        {
          id: "1",
          organizationId: "org1",
          employeeId: "emp1",
          eventType: "clock_in",
          occurredAt: "2026-11-02T08:00:00.000Z",
          recordedAt: "2026-11-02T08:00:00.000Z",
          source: "web",
          actorId: "emp1",
          prevHash: null,
          hash: "h1",
        },
        // Second clock-in without clock-out
        {
          id: "2",
          organizationId: "org1",
          employeeId: "emp1",
          eventType: "clock_in",
          occurredAt: "2026-11-02T13:00:00.000Z",
          recordedAt: "2026-11-02T13:00:00.000Z",
          source: "web",
          actorId: "emp1",
          prevHash: "h1",
          hash: "h2",
        },
        // Break started
        {
          id: "3",
          organizationId: "org1",
          employeeId: "emp1",
          eventType: "break_start",
          occurredAt: "2026-11-02T15:00:00.000Z",
          recordedAt: "2026-11-02T15:00:00.000Z",
          source: "web",
          actorId: "emp1",
          prevHash: "h2",
          hash: "h3",
        },
        // Clock out without break_end (break auto-closed)
        {
          id: "4",
          organizationId: "org1",
          employeeId: "emp1",
          eventType: "clock_out",
          occurredAt: "2026-11-02T17:00:00.000Z",
          recordedAt: "2026-11-02T17:00:00.000Z",
          source: "web",
          actorId: "emp1",
          prevHash: "h3",
          hash: "h4",
        },
      ];

      const sessions = foldSessions(events);
      expect(sessions.length).toBe(2);
      expect(sessions[0]?.isOpen).toBe(false);
      expect(sessions[1]?.isOpen).toBe(false);
      expect(sessions[1]?.totalBreakMinutes).toBe(120); // 15:00 to 17:00 = 120 min
    });

    it("property-based test: folded sessions never overlap chronologically", () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              clockInMinute: fc.integer({ min: 0, max: 1400 }),
              durationMinute: fc.integer({ min: 10, max: 300 }),
            }),
            { minLength: 1, maxLength: 5 },
          ),
          (rawRanges) => {
            // Build non-overlapping chronological mock clock events
            rawRanges.sort((a, b) => a.clockInMinute - b.clockInMinute);
            let lastMinute = 0;
            const events: TimeEvent[] = [];

            for (let i = 0; i < rawRanges.length; i++) {
              const range = rawRanges[i]!;
              const inMin = Math.max(lastMinute + 10, range.clockInMinute);
              const outMin = inMin + range.durationMinute;
              lastMinute = outMin;

              const inTime = new Date(
                1700000000000 + inMin * 60000,
              ).toISOString();
              const outTime = new Date(
                1700000000000 + outMin * 60000,
              ).toISOString();

              events.push({
                id: `in-${i}`,
                organizationId: "org",
                employeeId: "emp",
                eventType: "clock_in",
                occurredAt: inTime,
                recordedAt: inTime,
                source: "web",
                actorId: "emp",
                prevHash: null,
                hash: `h-in-${i}`,
              });
              events.push({
                id: `out-${i}`,
                organizationId: "org",
                employeeId: "emp",
                eventType: "clock_out",
                occurredAt: outTime,
                recordedAt: outTime,
                source: "web",
                actorId: "emp",
                prevHash: null,
                hash: `h-out-${i}`,
              });
            }

            const sessions = foldSessions(events);
            for (let j = 0; j < sessions.length - 1; j++) {
              const s1 = sessions[j]!;
              const s2 = sessions[j + 1]!;
              if (s1.clockOut && s2.clockIn) {
                expect(new Date(s1.clockOut).getTime()).toBeLessThanOrEqual(
                  new Date(s2.clockIn).getTime(),
                );
              }
            }
          },
        ),
      );
    });
  });
});
