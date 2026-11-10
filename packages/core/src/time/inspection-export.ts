import crypto from "node:crypto";
import { Temporal } from "temporal-polyfill";
import { localTimeOfDay } from "../calendar/business-date.js";
import { csvCell } from "../reports/csv.js";
import {
  inspectionExportLabels,
  type InspectionExportLabels,
  type InspectionExportLocale,
} from "./export-labels.js";
import type { EmploymentPeriod } from "./employment-periods.js";
import type { ChainStatus } from "./hash-chain.js";
import {
  buildInspectionRows,
  inspectionColumnLabels,
  inspectionRowCells,
  INSPECTION_NUMERIC_COLUMNS,
  type InspectionExportRow,
} from "./inspection-export-rows.js";
import type { DayTimesheetSummary } from "./timesheet-calculator.js";

export type InspectionExportScope = "employee" | "organization";

export interface InspectionExportEmployee {
  employeeId: string;
  name: string;
  /**
   * IANA zone of this employee's local days and clock times: their
   * location's zone, else the organization's. Days were split in this zone.
   */
  timeZone: string;
  /** Local-day summaries of the period; null when no schedule is configured. */
  days: readonly DayTimesheetSummary[] | null;
  /** Local dates with at least one TIM-003 correction event. */
  correctedDates: readonly string[];
  /** Result of the TIM-002 chain verifier, when it was run. */
  chainStatus?: ChainStatus | undefined;
  /**
   * Employment periods overlapping the export period (local dates,
   * inclusive). A day outside all of them is exported with `employed: false`
   * and 0 expected minutes; its recorded work is still listed. Null when
   * unknown (no employment records): every day counts as employed.
   */
  employmentPeriods: readonly EmploymentPeriod[] | null;
}

export interface InspectionExportInput {
  exportId: string;
  locale: InspectionExportLocale;
  scope: InspectionExportScope;
  organizationName: string;
  /** First and last local dates of the period (`YYYY-MM-DD`, inclusive). */
  periodStart: string;
  periodEnd: string;
  /**
   * Organization's IANA zone, shown in the header and used for the local
   * generation time. Rows use each employee's own `timeZone`.
   */
  timeZone: string;
  /** ISO instant (UTC); the caller's clock, never read here. */
  generatedAt: string;
  generatedBy: { name: string; role: string };
  employees: readonly InspectionExportEmployee[];
}

export interface InspectionExportResult {
  exportId: string;
  /** SHA-256 (hex) of the CSV body: every line before the signature line. */
  contentHash: string;
  /** Full CSV file (UTF-8, CRLF, no BOM), ending with `# sha256=<hash>`. */
  csv: string;
  rows: InspectionExportRow[];
  /** Localized table header, in column order. */
  columns: string[];
  /** Localized `Label: value` generation metadata, in document order. */
  metadataLines: string[];
}

const CRLF = "\r\n";

/** Metadata values sit on one comment line: fold any line break away. */
function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function metadata(
  input: InspectionExportInput,
  labels: InspectionExportLabels,
): string[] {
  const generatedAt = Temporal.Instant.from(input.generatedAt);
  const generatedAtUtc = generatedAt.toString();
  const localDate = generatedAt
    .toZonedDateTimeISO(input.timeZone)
    .toPlainDate()
    .toString();
  const localTime = localTimeOfDay(generatedAtUtc, input.timeZone);
  const m = labels.meta;
  const by = `${oneLine(input.generatedBy.name)} (${oneLine(input.generatedBy.role)})`;
  return [
    `${m.document}: ${labels.title}`,
    `${m.organization}: ${oneLine(input.organizationName)}`,
    `${m.period}: ${input.periodStart} – ${input.periodEnd}`,
    `${m.scope}: ${labels.scope[input.scope]}`,
    `${m.timeZone}: ${oneLine(input.timeZone)}`,
    `${m.generatedAt}: ${generatedAtUtc} (${localDate} ${localTime})`,
    `${m.generatedBy}: ${by}`,
    `${m.exportId}: ${oneLine(input.exportId)}`,
  ];
}

/**
 * Builds the Labour Inspectorate working-time export (TIM-006, ET art. 34.9):
 * one row per employee per local day, preceded by generation metadata and
 * signed with a content hash. Days outside the employee's employment
 * periods are flagged `employed: false` and expect nothing (never a fake
 * absence). Each employee's days and clock times are in
 * that employee's zone (named on every row), so an employee's rows are the
 * same in an employee and an organization export; the header zone is the
 * organization's.
 *
 * The CSV is the canonical form. Its body is the metadata as `# Label: value`
 * comment lines (a line holding a comma or quote is wrapped in RFC 4180 quotes
 * so it stays one cell), the localized header row and the data rows, each ending in
 * CRLF. `contentHash` is the SHA-256 (hex) of the UTF-8 bytes of that body,
 * and the file's last line is exactly `# sha256=<contentHash>` + CRLF. The
 * hashed bytes never include a BOM: a server that prepends one for
 * spreadsheet software must strip it before verifying.
 *
 * Same input, same bytes: nothing here reads a clock or random source.
 *
 * @example
 * const result = createInspectionExport({
 *   exportId: "0b8f…", locale: "es", scope: "employee",
 *   organizationName: "Acme", periodStart: "2026-11-01", periodEnd: "2026-11-30",
 *   timeZone: "Europe/Madrid", generatedAt: "2026-12-01T09:00:00Z",
 *   generatedBy: { name: "Ana Ruiz", role: "admin" },
 *   employees: [{
 *     employeeId: "e1", name: "Marta Garcia", timeZone: "Atlantic/Canary",
 *     days, correctedDates: [], employmentPeriods: null,
 *   }],
 * });
 * // Verify a downloaded file (shell): head -n -1 export.csv | sha256sum
 * // Verify in code:
 * const body = result.csv.slice(0, result.csv.lastIndexOf("# sha256="));
 * crypto.createHash("sha256").update(body, "utf8").digest("hex") === result.contentHash; // true
 */
export function createInspectionExport(
  input: InspectionExportInput,
): InspectionExportResult {
  const labels = inspectionExportLabels(input.locale);
  const rows = buildInspectionRows(input);
  const columns = inspectionColumnLabels(labels);
  const metadataLines = metadata(input, labels);

  const lines = [
    // A comma in a value would otherwise split the comment line into cells in
    // a spreadsheet, and the next cell could start with "=": quote the line.
    ...metadataLines.map((line) => csvCell(`# ${line}`)),
    columns.map((label) => csvCell(label)).join(","),
    ...rows.map((row) =>
      inspectionRowCells(row, labels)
        .map((cell, index) =>
          csvCell(cell, { numeric: INSPECTION_NUMERIC_COLUMNS.has(index) }),
        )
        .join(","),
    ),
  ];
  const body = lines.map((line) => line + CRLF).join("");
  const contentHash = crypto
    .createHash("sha256")
    .update(body, "utf8")
    .digest("hex");

  return {
    exportId: input.exportId,
    contentHash,
    csv: `${body}# sha256=${contentHash}${CRLF}`,
    rows,
    columns,
    metadataLines,
  };
}
