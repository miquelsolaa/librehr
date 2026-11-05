import { describe, it, expect } from "vitest";
import {
  validateRestPeriod,
  calculateDailyTimesheet,
  calculatePeriodTimesheet,
  buildInspectionExport,
  foldSessions,
  type TimeEvent,
} from "../src/index.js";

describe("Time Tracking Pure Domain (TIM-001 - TIM-006)", () => {
  it("detects statutory 12-hour rest period violations between consecutive shifts (ET art. 34.3)", () => {
    // Finished at 22:00, started next day at 07:00 (9 hours rest, violation of 12h rule)
    const violation = validateRestPeriod(
      "2026-11-02T22:00:00Z",
      "2026-11-03T07:00:00Z",
      12,
    );
    expect(violation).not.toBeNull();
    expect(violation?.actualRestHours).toBe(9);
    expect(violation?.requiredRestHours).toBe(12);

    // Finished at 18:00, started next day at 09:00 (15 hours rest, compliant)
    const compliant = validateRestPeriod(
      "2026-11-02T18:00:00Z",
      "2026-11-03T09:00:00Z",
      12,
    );
    expect(compliant).toBeNull();
  });

  it("calculates daily timesheet worked minutes and overtime against scheduled rules", () => {
    const events: TimeEvent[] = [
      {
        id: "e1",
        organizationId: "org-1",
        employeeId: "emp-1",
        eventType: "clock_in",
        occurredAt: "2026-11-02T08:00:00Z",
        recordedAt: "2026-11-02T08:00:00Z",
        source: "web",
        actorId: "emp-1",
        prevHash: null,
        hash: "h1",
      },
      {
        id: "e2",
        organizationId: "org-1",
        employeeId: "emp-1",
        eventType: "break_start",
        occurredAt: "2026-11-02T13:00:00Z",
        recordedAt: "2026-11-02T13:00:00Z",
        source: "web",
        actorId: "emp-1",
        prevHash: "h1",
        hash: "h2",
      },
      {
        id: "e3",
        organizationId: "org-1",
        employeeId: "emp-1",
        eventType: "break_end",
        occurredAt: "2026-11-02T14:00:00Z",
        recordedAt: "2026-11-02T14:00:00Z",
        source: "web",
        actorId: "emp-1",
        prevHash: "h2",
        hash: "h3",
      },
      {
        id: "e4",
        organizationId: "org-1",
        employeeId: "emp-1",
        eventType: "clock_out",
        occurredAt: "2026-11-02T17:30:00Z",
        recordedAt: "2026-11-02T17:30:00Z",
        source: "web",
        actorId: "emp-1",
        prevHash: "h3",
        hash: "h4",
      },
    ];

    const sessions = foldSessions(events);
    const daily = calculateDailyTimesheet("2026-11-02", sessions, {
      dayOfWeek: 1,
      expectedHours: 8.0,
    });

    // 08:00 to 17:30 = 9h30m (570m) gross - 60m break = 510m (8.5h) net
    expect(daily.totalWorkedMinutes).toBe(510);
    expect(daily.totalBreakMinutes).toBe(60);
    expect(daily.overtimeMinutes).toBe(30); // 510 - 480 = 30m overtime
    expect(daily.hasAnomaly).toBe(false);
  });

  it("requires an explicit schedule rule rather than assuming eight hours", () => {
    expect(() => calculateDailyTimesheet("2026-11-02", [])).toThrow(
      "Schedule rule is required",
    );
  });

  it("builds official Labour Inspection export with cryptographic SHA-256 integrity hash", () => {
    const daily = calculateDailyTimesheet("2026-11-02", [], {
      dayOfWeek: 1,
      expectedHours: 8,
    });
    const doc = buildInspectionExport(
      {
        organizationId: "00000000-0000-0000-0000-000000000001",
        organizationName: "Acme Corp",
        employeeId: "11111111-1111-1111-1111-111111111111",
        employeeName: "Marta Garcia",
        periodStart: "2026-11-01",
        periodEnd: "2026-11-30",
        generatedAt: "2026-12-01T00:00:00Z",
        generatorActorId: "admin-1",
      },
      [daily],
    );

    expect(doc.documentContentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(doc.metadata.organizationName).toBe("Acme Corp");
  });

  it("computes period totals accurately across multiple days", () => {
    const day1 = calculateDailyTimesheet("2026-11-02", [], {
      dayOfWeek: 1,
      expectedHours: 8,
    });
    const day2 = calculateDailyTimesheet("2026-11-03", [], {
      dayOfWeek: 2,
      expectedHours: 8,
    });

    const period = calculatePeriodTimesheet([day1, day2]);
    expect(period.totalExpectedHours).toBe(16);
    expect(period.totalWorkedMinutes).toBe(0);
    expect(period.totalOvertimeMinutes).toBe(-960);
  });
});
