import { describe, it, expect } from "vitest";
import {
  createInspectionExport,
  encodeWinAnsi,
  renderInspectionPdf,
  renderTextPdf,
  textWidth,
  type TextPdfInput,
} from "../src/index.js";
import {
  baseInput,
  day,
  latin1,
  session,
} from "./support/inspection-fixtures.js";

function pdfInput(
  rowCount: number,
  title = "Registre de jornada",
): TextPdfInput {
  return {
    title,
    headerLines: ["Organització: Acme", "Període: 2026-11-01 – 2026-11-30"],
    table: {
      columns: [
        { label: "Persona treballadora", width: 120 },
        { label: "Data", width: 60 },
        { label: "Treballat (min)", width: 40, align: "right" },
      ],
      rows: Array.from({ length: rowCount }, (_, i) => [
        `Persona ${i}`,
        "2026-11-02",
        String(i),
      ]),
    },
    footer: (page, count) => `Pàgina ${page} de ${count}`,
    creationDate: "2026-12-01T09:15:00Z",
  };
}

function pageCount(pdf: string): number {
  return (pdf.match(/\/Type \/Page\b(?!s)/g) ?? []).length;
}

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

describe("encodeWinAnsi", () => {
  it("maps Catalan and Spanish letters to their WinAnsi bytes", () => {
    expect([...encodeWinAnsi("àéíòóúçñ·l")]).toEqual([
      0xe0, 0xe9, 0xed, 0xf2, 0xf3, 0xfa, 0xe7, 0xf1, 0xb7, 0x6c,
    ]);
    expect([...encodeWinAnsi("€…–’")]).toEqual([0x80, 0x85, 0x96, 0x92]);
  });

  it("replaces characters outside WinAnsi with one ? each", () => {
    expect([...encodeWinAnsi("a😀b中")]).toEqual([0x61, 0x3f, 0x62, 0x3f]);
    expect([...encodeWinAnsi("a\tb\nc")]).toEqual([
      0x61, 0x20, 0x62, 0x20, 0x63,
    ]);
  });
});

describe("textWidth (Helvetica AFM metrics)", () => {
  it("covers the whole WinAnsi range of both fonts", () => {
    expect(textWidth("Hi", "regular", 10)).toBeCloseTo(9.44);
    expect(textWidth("ÿ", "regular", 1000)).toBe(500);
    expect(textWidth("ÿ", "bold", 1000)).toBe(556);
    expect(textWidth("W", "bold", 1000)).toBe(944);
  });
});

describe("renderTextPdf", () => {
  it("writes a PDF 1.4 file that ends with %%EOF", () => {
    const pdf = latin1(renderTextPdf(pdfInput(3)));
    expect(pdf.startsWith("%PDF-1.4\n")).toBe(true);
    expect(pdf.endsWith("%%EOF\n")).toBe(true);
    expect(pdf).toContain("/BaseFont /Helvetica /Encoding /WinAnsiEncoding");
    expect(pdf).toContain(
      "/BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding",
    );
    expect(pdf).toContain("/MediaBox [0 0 595 842]");
    expect(pdf).toContain("/Producer (LibreHR)");
    expect(pdf).toContain("/CreationDate (D:20261201091500Z)");
  });

  it("has an xref table whose offsets point at their objects", () => {
    const pdf = latin1(renderTextPdf(pdfInput(120)));
    const startxref = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(pdf)?.[1]);
    expect(pdf.startsWith("xref\n", startxref)).toBe(true);
    const header = /^xref\n0 (\d+)\n/.exec(pdf.slice(startxref));
    const size = Number(header?.[1]);
    const entries = pdf
      .slice(startxref + (header?.[0].length ?? 0))
      .split("\n")
      .slice(0, size);
    expect(entries[0]).toBe("0000000000 65535 f ");
    for (let n = 1; n < size; n++) {
      const entry = entries[n] ?? "";
      expect(entry).toMatch(/^\d{10} 00000 n $/);
      expect(pdf.startsWith(`${n} 0 obj\n`, Number(entry.slice(0, 10)))).toBe(
        true,
      );
    }
    expect(pdf).toContain(
      `trailer\n<< /Size ${size} /Root 1 0 R /Info 5 0 R >>`,
    );
  });

  it("declares exact stream lengths", () => {
    const pdf = latin1(renderTextPdf(pdfInput(80)));
    const streams = [...pdf.matchAll(/\/Length (\d+) >>\nstream\n/g)];
    expect(streams.length).toBeGreaterThan(1);
    for (const match of streams) {
      const start = (match.index ?? 0) + match[0].length;
      const end = start + Number(match[1]);
      expect(pdf.slice(end, end + 10)).toBe("\nendstream");
    }
  });

  it("adds pages as rows grow and repeats the table header on each", () => {
    const one = latin1(renderTextPdf(pdfInput(5)));
    const many = latin1(renderTextPdf(pdfInput(300)));
    expect(pageCount(one)).toBe(1);
    expect(pageCount(many)).toBeGreaterThan(2);
    expect(many).toContain(`/Count ${pageCount(many)}`);
    const headers = many.match(/\(Data\) Tj/g) ?? [];
    expect(headers).toHaveLength(pageCount(many));
    const last = pageCount(many);
    expect(many).toContain(`(Pàgina 1 de ${last}) Tj`);
    expect(many).toContain(`(Pàgina ${last} de ${last}) Tj`);
  });

  it("encodes accents as WinAnsi bytes and unknown characters as ?", () => {
    const bytes = renderTextPdf(pdfInput(1, "àéíòóúçñ·l 😀"));
    const needle = Uint8Array.from([
      0x28, 0xe0, 0xe9, 0xed, 0xf2, 0xf3, 0xfa, 0xe7, 0xf1, 0xb7, 0x6c, 0x20,
      0x3f, 0x29,
    ]);
    expect(indexOfBytes(bytes, needle)).toBeGreaterThan(0);
  });

  it("escapes parentheses and backslashes in strings", () => {
    const pdf = latin1(renderTextPdf(pdfInput(1, "f(x) \\ y")));
    expect(pdf).toContain("(f\\(x\\) \\\\ y) Tj");
    expect(pdf).toContain("/Title (f\\(x\\) \\\\ y)");
  });

  it("truncates cells wider than their column with an ellipsis", () => {
    const input = pdfInput(0);
    const pdf = latin1(
      renderTextPdf({
        ...input,
        table: { ...input.table, rows: [["A".repeat(200), "2026-11-02", "1"]] },
      }),
    );
    expect(pdf).toMatch(/\(A+\u0085\) Tj/);
    expect(pdf).not.toContain("A".repeat(200));
  });

  it("wraps cells of a maxLines column and never splits a row across pages", () => {
    const input = pdfInput(0);
    const wrapped: TextPdfInput = {
      ...input,
      table: {
        columns: [
          { label: "Persona", width: 40, maxLines: 3 },
          { label: "Data", width: 60 },
        ],
        rows: Array.from({ length: 120 }, (_, i) => [
          "Alfabet Betacism Gammaray",
          `Row${i}`,
        ]),
      },
    };
    const pdf = latin1(renderTextPdf(wrapped));
    // Three lines per row take more pages than one line per row.
    expect(pageCount(pdf)).toBeGreaterThan(
      pageCount(latin1(renderTextPdf(pdfInput(120)))),
    );
    expect(pdf).not.toContain("\u0085");
    const count = (text: string, word: string) =>
      text.split(`(${word}) Tj`).length - 1;
    let rows = 0;
    for (const stream of pdf.split("endstream")) {
      const here = (stream.match(/\(Row\d+\) Tj/g) ?? []).length;
      rows += here;
      // Every row on this page has all three of its lines on it.
      for (const word of ["Alfabet", "Betacism", "Gammaray"]) {
        expect(count(stream, word)).toBe(here);
      }
    }
    expect(rows).toBe(120);
  });

  it("is deterministic", () => {
    expect(renderTextPdf(pdfInput(150))).toEqual(renderTextPdf(pdfInput(150)));
  });
});

describe("renderInspectionPdf (TIM-006)", () => {
  const days = Array.from({ length: 120 }, (_, i) => {
    const date = `2026-${String(1 + Math.floor(i / 28)).padStart(2, "0")}-${String(1 + (i % 28)).padStart(2, "0")}`;
    return day(date, [session(`${date}T08:00:00Z`, `${date}T16:00:00Z`)]);
  });
  const input = baseInput({
    locale: "ca",
    periodStart: "2026-01-01",
    periodEnd: "2026-05-28",
    employees: [
      {
        employeeId: "e1",
        name: "Núria Puig",
        timeZone: "Europe/Madrid",
        days,
        correctedDates: [],
        employmentPeriods: null,
      },
    ],
  });

  it("prints the metadata and the export id, hash and page on every page", () => {
    const result = createInspectionExport(input);
    const pdf = latin1(renderInspectionPdf(result, input));
    const pages = pageCount(pdf);
    expect(pages).toBeGreaterThan(1);
    expect(pdf).toContain("(Registre de jornada) Tj");
    expect(pdf).toContain("(Organització: Acme Serveis SL) Tj");
    const footer = `${result.exportId} · sha256 ${result.contentHash} · Pàgina`;
    expect(pdf.split(footer)).toHaveLength(pages + 1);
    expect(pdf).toContain(`Pàgina ${pages} de ${pages}) Tj`);
    expect(pdf).toContain("(Núria Puig) Tj");
    expect(pdf).toContain("/CreationDate (D:20261201091500Z)");
  });

  it("is deterministic", () => {
    const result = createInspectionExport(input);
    expect(renderInspectionPdf(result, input)).toEqual(
      renderInspectionPdf(createInspectionExport(input), input),
    );
  });
});
