import crypto from "node:crypto";
import type { DayTimesheetSummary } from "./timesheet-calculator.js";

export interface InspectionExportMetadata {
  organizationId: string;
  organizationName: string;
  employeeId: string;
  employeeName: string;
  nationalId?: string | undefined;
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
  generatorActorId: string;
}

export interface InspectionExportDocument {
  metadata: InspectionExportMetadata;
  days: DayTimesheetSummary[];
  totalWorkedMinutes: number;
  totalOvertimeMinutes: number;
  documentContentHash: string; // SHA-256 tamper-evident integrity hash
}

/**
 * Generates official Spanish Labour Inspection compliant export structure
 * with cryptographic content verification (ET art. 34.9).
 */
export function buildInspectionExport(
  metadata: InspectionExportMetadata,
  days: DayTimesheetSummary[],
): InspectionExportDocument {
  let totalWorked = 0;
  let totalOvertime = 0;

  for (const d of days) {
    totalWorked += d.totalWorkedMinutes;
    totalOvertime += d.overtimeMinutes;
  }

  const payloadToHash = JSON.stringify({
    metadata,
    days: days.map((d) => ({
      date: d.date,
      totalWorkedMinutes: d.totalWorkedMinutes,
      overtimeMinutes: d.overtimeMinutes,
      sessions: d.sessions.map((s) => ({
        clockIn: s.clockIn,
        clockOut: s.clockOut ?? null,
        netWorkedDurationMinutes: s.netWorkedDurationMinutes,
      })),
    })),
  });

  const documentContentHash = crypto
    .createHash("sha256")
    .update(payloadToHash, "utf-8")
    .digest("hex");

  return {
    metadata,
    days,
    totalWorkedMinutes: totalWorked,
    totalOvertimeMinutes: totalOvertime,
    documentContentHash,
  };
}
