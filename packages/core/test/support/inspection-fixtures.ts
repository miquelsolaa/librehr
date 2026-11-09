import crypto from "node:crypto";
import type {
  DayTimesheetSummary,
  InspectionExportInput,
  WorkSession,
} from "../../src/index.js";
import { isoDayOfWeek } from "../../src/index.js";

/** A closed (or, without `clockOut`, open) session between two instants. */
export function session(clockIn: string, clockOut?: string): WorkSession {
  const minutes = clockOut
    ? (Date.parse(clockOut) - Date.parse(clockIn)) / 60000
    : 0;
  return {
    clockIn,
    ...(clockOut ? { clockOut } : {}),
    isOpen: !clockOut,
    breaks: [],
    grossDurationMinutes: minutes,
    totalBreakMinutes: 0,
    netWorkedDurationMinutes: minutes,
  };
}

export function day(
  date: string,
  sessions: WorkSession[],
  expectedHours = 8,
): DayTimesheetSummary {
  const worked = sessions.reduce((s, x) => s + x.netWorkedDurationMinutes, 0);
  return {
    date,
    dayOfWeek: isoDayOfWeek(date),
    sessions,
    totalWorkedMinutes: worked,
    totalBreakMinutes: 0,
    expectedHours,
    overtimeMinutes: worked - Math.round(expectedHours * 60),
    hasAnomaly: sessions.some((s) => s.isOpen),
  };
}

export function baseInput(
  overrides: Partial<InspectionExportInput> = {},
): InspectionExportInput {
  return {
    exportId: "7d3c1f2e-0000-4000-8000-000000000001",
    locale: "es",
    scope: "employee",
    organizationName: "Acme Serveis SL",
    periodStart: "2026-11-02",
    periodEnd: "2026-11-03",
    timeZone: "Europe/Madrid",
    generatedAt: "2026-12-01T09:15:00Z",
    generatedBy: { name: "Ana Ruiz", role: "admin" },
    employees: [
      {
        employeeId: "e1",
        name: "Marta Garcia",
        days: [
          day("2026-11-02", [
            session("2026-11-02T08:00:00Z", "2026-11-02T12:00:00Z"),
            session("2026-11-02T13:00:00Z", "2026-11-02T16:30:00Z"),
          ]),
          day("2026-11-03", [session("2026-11-03T08:00:00Z")]),
        ],
        correctedDates: ["2026-11-03"],
        chainStatus: "verified",
      },
    ],
    ...overrides,
  };
}

export function sha256(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

/** Minimal RFC 4180 parser (CRLF records, quoted fields). */
export function parseCsv(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      record.push(field);
      field = "";
    } else if (ch === "\r" && text[i + 1] === "\n") {
      record.push(field);
      records.push(record);
      record = [];
      field = "";
      i++;
    } else {
      field += ch;
    }
  }
  if (field !== "" || record.length > 0) records.push([...record, field]);
  return records;
}

/** Bytes as a Latin-1 string, to search PDF syntax. */
export function latin1(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("latin1");
}
