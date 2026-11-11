import { describe, expect, it } from "vitest";
import {
  createInspectionExport,
  inspectionExportLabels,
  INSPECTION_EXPORT_LOCALES,
  INSPECTION_PDF_COLUMN_LAYOUT,
  renderInspectionPdf,
  textWidth,
  winAnsiBinaryString,
} from "../src/index.js";
import { wrap } from "../src/reports/pdf/pdf-text.js";
import {
  baseInput,
  day,
  latin1,
  session,
} from "./support/inspection-fixtures.js";

// Real Helvetica metrics at the table's size, minus the cell padding.
const TABLE_SIZE = 6.5;
const PADDING = 2 * 2;
const ELLIPSIS = "\u0085";
const NAME = "María del Carmen García Fernández";
const COLUMN = {
  employee: 0,
  date: 1,
  sessions: 2,
  chainStatus: 9,
  timeZone: 10,
  employed: 11,
} as const;

const room = (column: number) =>
  (INSPECTION_PDF_COLUMN_LAYOUT[column]?.width ?? 0) - PADDING;
const widthOf = (text: string, font: "regular" | "bold" = "regular") =>
  textWidth(winAnsiBinaryString(text), font, TABLE_SIZE);

describe("inspection PDF layout (TIM-006)", () => {
  it("fits the A4 content width with one width per column", () => {
    const total = INSPECTION_PDF_COLUMN_LAYOUT.reduce((s, c) => s + c.width, 0);
    expect(total).toBeLessThanOrEqual(515);
    const columns = createInspectionExport(baseInput()).columns;
    expect(INSPECTION_PDF_COLUMN_LAYOUT).toHaveLength(columns.length);
  });

  it("never cuts a header word, in any locale", () => {
    for (const locale of INSPECTION_EXPORT_LOCALES) {
      const columns = createInspectionExport(baseInput({ locale })).columns;
      columns.forEach((label, i) => {
        for (const word of label.split(" ")) {
          const fits = widthOf(word, "bold") <= room(i);
          expect([locale, word, fits]).toEqual([locale, word, true]);
        }
      });
    }
  });

  it("fits typical body cells on one line", () => {
    const cells: [number, string][] = [
      [COLUMN.date, "2026-11-02"],
      [COLUMN.sessions, "09:00-14:00 | 15:00-18:30"],
      [COLUMN.timeZone, "Atlantic/Canary"],
    ];
    for (const locale of INSPECTION_EXPORT_LOCALES) {
      const labels = inspectionExportLabels(locale);
      for (const flag of [labels.yes, labels.no]) {
        for (const column of [7, 8, COLUMN.employed])
          cells.push([column, flag]);
      }
    }
    for (const [column, text] of cells) {
      expect([text, widthOf(text) <= room(column)]).toEqual([text, true]);
    }
  });

  it("wraps every integrity status fully, in any locale", () => {
    const maxLines = INSPECTION_PDF_COLUMN_LAYOUT[COLUMN.chainStatus]?.maxLines;
    for (const locale of INSPECTION_EXPORT_LOCALES) {
      for (const status of Object.values(
        inspectionExportLabels(locale).chainStatus,
      )) {
        const bytes = winAnsiBinaryString(status);
        const lines = wrap(
          bytes,
          "regular",
          TABLE_SIZE,
          room(COLUMN.chainStatus),
          maxLines ?? 1,
        );
        expect(lines.join(" ")).toBe(bytes);
        expect(lines.some((line) => line.includes(ELLIPSIS))).toBe(false);
      }
    }
  });

  it("wraps a long employee name fully instead of cutting it", () => {
    const maxLines = INSPECTION_PDF_COLUMN_LAYOUT[COLUMN.employee]?.maxLines;
    expect(maxLines).toBeGreaterThan(1);
    const lines = wrap(
      winAnsiBinaryString(NAME),
      "regular",
      TABLE_SIZE,
      room(COLUMN.employee),
      maxLines ?? 1,
    );
    expect(lines.join(" ")).toBe(winAnsiBinaryString(NAME));
    for (const line of lines) {
      expect(line).not.toContain(ELLIPSIS);
      expect(widthOf(line)).toBeLessThanOrEqual(room(COLUMN.employee));
    }
  });

  it("renders the long name in the PDF without an ellipsis", () => {
    const input = baseInput({
      employees: [
        {
          employeeId: "e1",
          name: NAME,
          timeZone: "Atlantic/Canary",
          days: [
            day("2026-11-02", [
              session("2026-11-02T09:00:00Z", "2026-11-02T14:00:00Z"),
              session("2026-11-02T15:00:00Z", "2026-11-02T18:30:00Z"),
            ]),
          ],
          correctedDates: [],
          employmentPeriods: null,
        },
      ],
    });
    const pdf = latin1(
      renderInspectionPdf(createInspectionExport(input), input),
    );
    const shown = [...pdf.matchAll(/\(([^)]*)\) Tj/g)].map((m) => m[1]);
    expect(shown.some((text) => text?.includes(ELLIPSIS))).toBe(false);
    expect(shown).toContain("09:00-14:00 | 15:00-18:30");
    const nameWords = winAnsiBinaryString(NAME).split(" ");
    const nameLines = shown.filter((text) =>
      nameWords.some((word) => text?.split(" ").includes(word)),
    );
    expect(nameLines.join(" ")).toBe(winAnsiBinaryString(NAME));
  });
});
