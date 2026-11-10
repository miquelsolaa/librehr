import {
  renderTextPdf,
  type PdfTableColumn,
} from "../reports/pdf/minimal-pdf.js";
import { inspectionExportLabels } from "./export-labels.js";
import type {
  InspectionExportInput,
  InspectionExportResult,
} from "./inspection-export.js";
import { inspectionRowCells } from "./inspection-export-rows.js";

/**
 * Column widths of the export table in points, in column order. They add up
 * to the A4 content width (515), every word of every header label fits its
 * column (headers wrap but are never cut) and typical cells fit on one line;
 * the employee name wraps onto up to four lines, the integrity status onto
 * two (tested).
 */
export const INSPECTION_PDF_COLUMN_LAYOUT: readonly Pick<
  PdfTableColumn,
  "width" | "align" | "maxLines"
>[] = [
  // The name is the only identifier on paper: it wraps instead of being cut.
  { width: 62, maxLines: 4 },
  // Fits "2026-11-02".
  { width: 40 },
  // Fits two sessions; more are cut with an ellipsis.
  { width: 80 },
  { width: 30, align: "right" },
  { width: 36, align: "right" },
  { width: 34, align: "right" },
  { width: 36, align: "right" },
  { width: 36 },
  { width: 36 },
  // Integrity: "Sense dades" wraps onto two lines.
  { width: 36, maxLines: 2 },
  // Time zone: fits "Atlantic/Canary"; longer names are cut with an ellipsis.
  { width: 49 },
  // Employed.
  { width: 40 },
];

/**
 * Renders a {@link createInspectionExport} result as a PDF: the metadata
 * lines, then the table, and on every page a footer
 * `<exportId> · sha256 <contentHash> · Page n of m` (localized). The hash is
 * the CSV's: the PDF is traced through its export id, not hashed itself.
 *
 * @example
 * const result = createInspectionExport(input);
 * const pdf = renderInspectionPdf(result, input); // Uint8Array, "%PDF-1.4"…
 */
export function renderInspectionPdf(
  result: InspectionExportResult,
  input: Pick<InspectionExportInput, "locale" | "generatedAt">,
): Uint8Array {
  const labels = inspectionExportLabels(input.locale);
  return renderTextPdf({
    title: labels.title,
    // The first metadata line names the document: the PDF title says it.
    headerLines: result.metadataLines.slice(1),
    table: {
      columns: result.columns.map((label, i) => ({
        label,
        width: INSPECTION_PDF_COLUMN_LAYOUT[i]?.width ?? 40,
        align: INSPECTION_PDF_COLUMN_LAYOUT[i]?.align,
        maxLines: INSPECTION_PDF_COLUMN_LAYOUT[i]?.maxLines,
      })),
      rows: result.rows.map((row) => inspectionRowCells(row, labels)),
    },
    footer: (page, pageCount) =>
      `${result.exportId} · sha256 ${result.contentHash} · ${labels.page(page, pageCount)}`,
    creationDate: input.generatedAt,
  });
}
