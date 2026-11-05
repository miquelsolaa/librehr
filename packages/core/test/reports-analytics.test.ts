import { describe, it, expect } from "vitest";
import {
  calculateHeadcountMetrics,
  calculateAbsenceMetrics,
  generateGestoriaCsv,
  generateIcsCalendar,
} from "../src/index.js";

describe("Milestone M5 Core Domain Logic (RPT-001, RPT-002, LEA-009)", () => {
  it("calculates accurate headcount metrics and turnover rates", () => {
    const employees = [
      { id: "e1", hireDate: "2025-01-01" }, // existing
      { id: "e2", hireDate: "2025-06-01" }, // existing
      { id: "e3", hireDate: "2026-02-15" }, // joined in period
      { id: "e4", hireDate: "2025-03-01", terminationDate: "2026-03-31" }, // leaver in period
    ];

    const metrics = calculateHeadcountMetrics(
      employees,
      "2026-01-01",
      "2026-06-30",
    );

    expect(metrics.startingHeadcount).toBe(3); // e1, e2, e4
    expect(metrics.endingHeadcount).toBe(3); // e1, e2, e3 (e4 left)
    expect(metrics.joinersCount).toBe(1); // e3
    expect(metrics.leaversCount).toBe(1); // e4
    expect(metrics.netChange).toBe(0);
    expect(metrics.turnoverRatePercent).toBe(33.33); // (1 / 3) * 100
  });

  it("calculates absence rates by category", () => {
    const absences = [
      { employeeId: "e1", category: "vacation" as const, workingDays: 5 },
      { employeeId: "e2", category: "sick" as const, workingDays: 2 },
      { employeeId: "e3", category: "unpaid" as const, workingDays: 1 },
    ];

    // 10 employees * 20 working days = 200 planned working days
    const metrics = calculateAbsenceMetrics(absences, 10, 20);

    expect(metrics.totalAbsentDays).toBe(8);
    expect(metrics.totalPlannedWorkingDays).toBe(200);
    expect(metrics.absenceRatePercent).toBe(4);
    expect(metrics.byCategory["vacation"]).toBe(5);
    expect(metrics.byCategory["sick"]).toBe(2);
  });

  it("generates valid RFC 4180 Spanish Gestoría payroll CSV export", () => {
    const data = [
      {
        taxId: "12345678Z",
        socialSecurityNumber: "081234567890",
        firstName: "Maria",
        lastName: "Garcia Lopez",
        contractType: "indefinido",
        workedDays: 18,
        vacationDays: 2,
        sickLeaveDays: 0,
        maternityPaternityDays: 0,
        unpaidLeaveDays: 0,
        overtimeHours: 4.5,
      },
    ];

    const csv = generateGestoriaCsv("2026-03", data);

    expect(csv).toContain(
      "Periodo,NIF_NIE,Num_SS,Apellidos,Nombre,Tipo_Contrato,Dias_Trabajados",
    );
    expect(csv).toContain(
      "2026-03,12345678Z,081234567890,Garcia Lopez,Maria,indefinido,18,2,0,0,0,4.50",
    );
  });

  it("neutralizes spreadsheet formulas in text fields without changing numeric values", () => {
    const csv = generateGestoriaCsv("2026-03", [
      {
        taxId: "=1+1",
        firstName: "  +formula",
        lastName: "@cmd",
        contractType: "-formula",
        workedDays: -1,
        vacationDays: 0,
        sickLeaveDays: 0,
        maternityPaternityDays: 0,
        unpaidLeaveDays: 0,
        overtimeHours: -1.5,
      },
    ]);
    expect(csv).toContain("'=1+1");
    expect(csv).toContain("'+formula");
    expect(csv).toContain("'@cmd");
    expect(csv).toContain("'-formula");
    expect(csv).toContain(",-1,0,0,0,0,-1.50");
  });

  it("generates valid RFC 5545 iCalendar feed", () => {
    const events = [
      {
        uid: "event-1",
        summary: "Maria - Vacation",
        startDateStr: "2026-07-01",
        endDateStr: "2026-07-05",
        description: "Approved summer leave",
      },
    ];

    const ics = generateIcsCalendar("LibreHR Team Calendar", events);

    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("VERSION:2.0");
    expect(ics).toContain("X-WR-CALNAME:LibreHR Team Calendar");
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("UID:event-1");
    expect(ics).toContain("DTSTART;VALUE=DATE:20260701");
    expect(ics).toContain("DTEND;VALUE=DATE:20260706"); // non-inclusive end date
    expect(ics).toContain("SUMMARY:Maria - Vacation");
    expect(ics).toContain("END:VCALENDAR");
  });
});
