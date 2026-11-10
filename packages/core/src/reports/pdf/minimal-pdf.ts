import { Temporal } from "temporal-polyfill";
import { textWidth, type PdfFont } from "./helvetica-metrics.js";
import { fit, wrap } from "./pdf-text.js";
import {
  binaryStringToBytes,
  pdfLiteral,
  winAnsiBinaryString,
} from "./winansi.js";

export interface PdfTableColumn {
  label: string;
  /** Width in points; all columns are scaled down together to fit the page. */
  width: number;
  align?: "left" | "right" | undefined;
  /**
   * Body cells wrap at spaces onto up to this many lines (the row grows to
   * its tallest cell); without it a cell stays on one line. Either way, text
   * that still does not fit ends in an ellipsis.
   */
  maxLines?: number | undefined;
}

export interface TextPdfInput {
  title: string;
  /** Lines under the title on the first page (metadata). */
  headerLines: readonly string[];
  table: {
    columns: readonly PdfTableColumn[];
    rows: readonly (readonly string[])[];
  };
  /** Footer of every page; it knows the final page count. */
  footer?: ((page: number, pageCount: number) => string) | undefined;
  /** ISO instant written as the document's /CreationDate. */
  creationDate: string;
}

const PAGE_WIDTH = 595; // A4 portrait, points
const PAGE_HEIGHT = 842;
const MARGIN = 40;
const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN;
const BOTTOM = MARGIN + 12; // keep clear of the footer
const FOOTER_Y = 24;
const TITLE_SIZE = 14;
const TEXT_SIZE = 9;
const TABLE_SIZE = 6.5;
const FOOTER_SIZE = 7;
const CELL_PADDING = 2;
const LEADING = 1.35;

const FONT_RESOURCE: Record<PdfFont, string> = { regular: "F1", bold: "F2" };

/** Fixed-precision number for content streams (deterministic, no exponent). */
function num(value: number): string {
  return value.toFixed(2).replace(/\.?0+$/, "");
}

function textOp(
  x: number,
  y: number,
  font: PdfFont,
  size: number,
  bytes: string,
) {
  return `BT /${FONT_RESOURCE[font]} ${num(size)} Tf ${num(x)} ${num(y)} Td ${pdfLiteral(bytes)} Tj ET`;
}

function pdfDate(isoInstant: string): string {
  const utc = Temporal.Instant.from(isoInstant).toZonedDateTimeISO("UTC");
  const two = (value: number) => String(value).padStart(2, "0");
  return `D:${String(utc.year).padStart(4, "0")}${two(utc.month)}${two(utc.day)}${two(utc.hour)}${two(utc.minute)}${two(utc.second)}Z`;
}

/** Lays out the document into one content-stream op list per page. */
function layout(input: TextPdfInput): string[][] {
  const pages: string[][] = [];
  let ops: string[] = [];
  let y = 0;
  const newPage = () => {
    ops = [];
    pages.push(ops);
    y = PAGE_HEIGHT - MARGIN;
  };
  newPage();

  y -= TITLE_SIZE;
  ops.push(
    textOp(
      MARGIN,
      y,
      "bold",
      TITLE_SIZE,
      fit(winAnsiBinaryString(input.title), "bold", TITLE_SIZE, CONTENT_WIDTH),
    ),
  );
  y -= TITLE_SIZE * 0.6;
  for (const line of input.headerLines) {
    if (y - TEXT_SIZE * LEADING < BOTTOM) newPage();
    y -= TEXT_SIZE * LEADING;
    ops.push(
      textOp(
        MARGIN,
        y,
        "regular",
        TEXT_SIZE,
        fit(winAnsiBinaryString(line), "regular", TEXT_SIZE, CONTENT_WIDTH),
      ),
    );
  }
  y -= TEXT_SIZE;

  const { columns, rows } = input.table;
  const total = columns.reduce((sum, column) => sum + column.width, 0);
  const scale = total > CONTENT_WIDTH ? CONTENT_WIDTH / total : 1;
  const widths = columns.map((column) => column.width * scale);
  const lefts = widths.map(
    (_, i) => MARGIN + widths.slice(0, i).reduce((a, b) => a + b, 0),
  );
  const tableRight = MARGIN + widths.reduce((a, b) => a + b, 0);
  const lineHeight = TABLE_SIZE * LEADING;
  const headerCells = columns.map((column, i) =>
    wrap(
      winAnsiBinaryString(column.label),
      "bold",
      TABLE_SIZE,
      (widths[i] ?? 0) - 2 * CELL_PADDING,
      2,
    ),
  );
  const headerLines = Math.max(1, ...headerCells.map((cell) => cell.length));
  const headerHeight = headerLines * lineHeight + 3;

  const cellX = (i: number, font: PdfFont, bytes: string) => {
    const left = (lefts[i] ?? MARGIN) + CELL_PADDING;
    if (columns[i]?.align !== "right") return left;
    return (
      (lefts[i] ?? MARGIN) +
      (widths[i] ?? 0) -
      CELL_PADDING -
      textWidth(bytes, font, TABLE_SIZE)
    );
  };
  const drawHeader = () => {
    headerCells.forEach((cell, i) => {
      cell.forEach((bytes, line) => {
        ops.push(
          textOp(
            cellX(i, "bold", bytes),
            y - (line + 1) * lineHeight + 1.5,
            "bold",
            TABLE_SIZE,
            bytes,
          ),
        );
      });
    });
    y -= headerHeight;
    ops.push(
      `0.5 w ${num(MARGIN)} ${num(y)} m ${num(tableRight)} ${num(y)} l S`,
    );
  };

  if (y - headerHeight - lineHeight < BOTTOM) newPage();
  drawHeader();
  for (const row of rows) {
    const cells = columns.map((column, i) => {
      const max = (widths[i] ?? 0) - 2 * CELL_PADDING;
      const bytes = winAnsiBinaryString(row[i] ?? "");
      return (column.maxLines ?? 1) > 1
        ? wrap(bytes, "regular", TABLE_SIZE, max, column.maxLines ?? 1)
        : [fit(bytes, "regular", TABLE_SIZE, max)];
    });
    const rowHeight =
      Math.max(1, ...cells.map((lines) => lines.length)) * lineHeight;
    // A row is never split across pages.
    if (y - rowHeight < BOTTOM) {
      newPage();
      drawHeader();
    }
    cells.forEach((lines, i) => {
      lines.forEach((bytes, line) => {
        if (bytes === "") return;
        ops.push(
          textOp(
            cellX(i, "regular", bytes),
            y - (line + 1) * lineHeight + 1.5,
            "regular",
            TABLE_SIZE,
            bytes,
          ),
        );
      });
    });
    y -= rowHeight;
  }
  return pages;
}

/**
 * Renders a text-and-table document as a minimal PDF 1.4 file: A4 portrait,
 * the standard (not embedded) Helvetica and Helvetica-Bold fonts with
 * WinAnsiEncoding, so Catalan and Spanish accents print and characters
 * outside WinAnsi become `?`. Rows flow onto new pages with the table
 * header repeated; a row is never split across pages. Cells too wide for
 * their column end in `…`, or first wrap onto more lines when the column
 * allows it (`maxLines`). Streams are
 * uncompressed and nothing reads a clock: the same input gives the same
 * bytes.
 *
 * @example
 * const bytes = renderTextPdf({
 *   title: "Registre de jornada",
 *   headerLines: ["Organització: Acme"],
 *   table: { columns: [{ label: "Data", width: 60 }], rows: [["2026-11-02"]] },
 *   footer: (page, count) => `Pàgina ${page} de ${count}`,
 *   creationDate: "2026-12-01T09:00:00Z",
 * });
 * // bytes starts with "%PDF-1.4" and ends with "%%EOF\n"
 */
export function renderTextPdf(input: TextPdfInput): Uint8Array {
  const pages = layout(input);
  const pageCount = pages.length;
  if (input.footer) {
    pages.forEach((ops, index) => {
      const text = winAnsiBinaryString(
        input.footer?.(index + 1, pageCount) ?? "",
      );
      ops.push(
        textOp(
          MARGIN,
          FOOTER_Y,
          "regular",
          FOOTER_SIZE,
          fit(text, "regular", FOOTER_SIZE, CONTENT_WIDTH),
        ),
      );
    });
  }

  // Objects: 1 catalog, 2 page tree, 3-4 fonts, 5 info, then page + contents pairs.
  const firstPage = 6;
  const pageRefs = pages.map((_, i) => `${firstPage + 2 * i} 0 R`);
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pageRefs.join(" ")}] /Count ${pageCount} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    `<< /Producer (LibreHR) /Title ${pdfLiteral(winAnsiBinaryString(input.title))} /CreationDate (${pdfDate(input.creationDate)}) >>`,
  ];
  pages.forEach((ops, i) => {
    const stream = ops.join("\n");
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${firstPage + 2 * i + 1} 0 R >>`,
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    );
  });

  // A binary comment after the header tells tools the file holds 8-bit bytes.
  let out = "%PDF-1.4\n%âãÏÓ\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefOffset = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets)
    out += `${String(offset).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 5 0 R >>\n`;
  out += `startxref\n${xrefOffset}\n%%EOF\n`;
  return binaryStringToBytes(out);
}
