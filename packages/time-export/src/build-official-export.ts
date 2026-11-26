import {
  createInspectionExport,
  datesInRange,
  renderInspectionPdf,
  type InspectionExportInput,
  type InspectionExportLocale,
  type InspectionExportResult,
  type InspectionExportScope,
} from "@librehr/core";
import { EmployeeRepository, type TenantTx } from "@librehr/db";
import {
  collectExportEmployee,
  type CollectedEmployee,
  type ExportSubject,
} from "./collect-employee.js";
import { createZoneResolver, type ZoneResolver } from "./zone-resolver.js";

const employeeRepo = new EmployeeRepository();

export type OfficialExportFormat = "json" | "csv" | "pdf";

/** A period of local dates (`YYYY-MM-DD`, inclusive). */
export interface ExportPeriod {
  startDate: string;
  endDate: string;
}

/**
 * Employees of an organization export and its size in employee-days
 * (employees × days of the period), which callers compare to their cap.
 */
export async function organizationExportSubjects(
  tx: TenantTx,
  period: ExportPeriod,
): Promise<{ subjects: ExportSubject[]; employeeDays: number }> {
  const subjects = await employeeRepo.listEmployedDuring(
    tx,
    period.startDate,
    period.endDate,
  );
  const days = datesInRange(period.startDate, period.endDate).length;
  return { subjects, employeeDays: subjects.length * days };
}

export interface OfficialExportRequest {
  exportId: string;
  /** ISO instant (UTC) of generation, from the caller's clock. */
  generatedAt: string;
  generatedBy: { name: string; role: string };
  organizationName: string;
  scope: InspectionExportScope;
  format: OfficialExportFormat;
  locale: InspectionExportLocale;
  period: ExportPeriod;
  /** Already authorized by the caller; read in this transaction. */
  subjects: readonly ExportSubject[];
  timeChainKey: string;
  /** Defaults to a resolver cached for this call. */
  zones?: ZoneResolver | undefined;
}

export type OfficialExportBuild =
  | {
      ok: true;
      input: InspectionExportInput;
      result: InspectionExportResult;
      /** Rendered only for the PDF format. */
      pdf: Uint8Array | null;
      employees: CollectedEmployee[];
    }
  /** Employee scope only: an employed day of the period has no schedule. */
  | { ok: false; reason: "schedule_not_configured" };

/**
 * TIM-006: builds the official working-time record (ET art. 34.9) for
 * `subjects` inside one tenant transaction. Authorization, caps, auditing
 * and delivery stay with the caller, so the synchronous route and a
 * background job produce the same document (and hash) for the same input.
 *
 * @example
 * const build = await buildOfficialExport(tx, { exportId, generatedAt,
 *   generatedBy, organizationName, scope: "organization", format: "csv",
 *   locale: "es", period, subjects, timeChainKey });
 * if (build.ok) store(build.result.csv, build.result.contentHash);
 */
export async function buildOfficialExport(
  tx: TenantTx,
  request: OfficialExportRequest,
): Promise<OfficialExportBuild> {
  const { period, subjects } = request;
  const zones = request.zones ?? createZoneResolver(tx);
  // The header shows the organization's zone; every employee's rows use
  // their own business zone, in both scopes.
  const timeZone = await zones(null);
  // One query for every subject: whose days count as employed.
  const employment = await employeeRepo.employmentPeriods(
    tx,
    subjects.map((subject) => subject.id),
    period.startDate,
    period.endDate,
  );
  const employees: CollectedEmployee[] = [];
  for (const subject of subjects) {
    // Every subject was just read in this transaction: a missing entry is a
    // bug, and defaulting to "employed every day" would bring back fake
    // absences, so fail loudly.
    const periods = employment.get(subject.id);
    if (periods === undefined) {
      throw new Error(
        "Invariant: employment periods missing for an export subject",
      );
    }
    employees.push(
      await collectExportEmployee(
        tx,
        zones,
        subject,
        period,
        periods,
        request.timeChainKey,
      ),
    );
  }
  // Only employed days need a schedule (core skips the others).
  if (request.scope === "employee" && employees[0]?.input.days === null) {
    return { ok: false, reason: "schedule_not_configured" };
  }

  const input: InspectionExportInput = {
    exportId: request.exportId,
    locale: request.locale,
    scope: request.scope,
    organizationName: request.organizationName,
    periodStart: period.startDate,
    periodEnd: period.endDate,
    timeZone,
    generatedAt: request.generatedAt,
    generatedBy: request.generatedBy,
    employees: employees.map((e) => e.input),
  };
  const result = createInspectionExport(input);
  const pdf =
    request.format === "pdf" ? renderInspectionPdf(result, input) : null;
  return { ok: true, input, result, pdf, employees };
}

/**
 * Metadata of the ADM-002 `time.export` audit entry: ids, period and hash
 * only, never names or emails (no PII).
 */
export function officialExportAuditMetadata(
  request: Pick<
    OfficialExportRequest,
    "scope" | "format" | "locale" | "period"
  >,
  build: { result: InspectionExportResult; employees: readonly unknown[] },
  subjectEmployeeId?: string | undefined,
): Record<string, unknown> {
  return {
    scope: request.scope,
    format: request.format,
    locale: request.locale,
    periodStart: request.period.startDate,
    periodEnd: request.period.endDate,
    employeeCount: build.employees.length,
    contentHash: build.result.contentHash,
    ...(subjectEmployeeId ? { employeeId: subjectEmployeeId } : {}),
  };
}
