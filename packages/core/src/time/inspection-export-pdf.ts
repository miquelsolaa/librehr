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
 * to the A4 content width (515) and every word of every header label fits
 * its column, so headers wrap but are never cut (tested).
 */
export const INSPECTION_PDF_COLUMN_LAYOUT: readonly Pick<
  PdfTableColumn,
  "width" | "align"
>[] = [
  { width: 62 },
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
  { width: 36 },
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
      })),
      rows: result.rows.map((row) => inspectionRowCells(row, labels)),
    },
    footer: (page, pageCount) =>
      `${result.exportId} · sha256 ${result.contentHash} · ${labels.page(page, pageCount)}`,
    creationDate: input.generatedAt,
  });
}
