import {
  renderTextPdf,
  type PdfTableColumn,
} from "../reports/pdf/minimal-pdf.js";
import { inspectionExportLabels } from "./export-labels.js";
import {
  inspectionRowCells,
  type InspectionExportInput,
  type InspectionExportResult,
} from "./inspection-export.js";

/** Column widths in points (A4 content width is 515), in column order. */
const COLUMN_LAYOUT: readonly Pick<PdfTableColumn, "width" | "align">[] = [
  { width: 80 },
  { width: 44 },
  { width: 100 },
  { width: 32, align: "right" },
  { width: 34, align: "right" },
  { width: 34, align: "right" },
  { width: 36, align: "right" },
  { width: 34 },
  { width: 33 },
  { width: 38 },
  // Time zone: fits "Atlantic/Canary"; longer names are cut with an ellipsis.
  { width: 50 },
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
        width: COLUMN_LAYOUT[i]?.width ?? 40,
        align: COLUMN_LAYOUT[i]?.align,
      })),
      rows: result.rows.map((row) => inspectionRowCells(row, labels)),
    },
    footer: (page, pageCount) =>
      `${result.exportId} · sha256 ${result.contentHash} · ${labels.page(page, pageCount)}`,
    creationDate: input.generatedAt,
  });
}
