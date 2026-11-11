import { describe, it, expect } from "vitest";
import { csvCell, sanitizeCsvValue } from "../src/index.js";

describe("csvCell (RFC 4180 + formula-injection guard)", () => {
  it.each([
    ["=1+1", "'=1+1"],
    ["+SUM(A1)", "'+SUM(A1)"],
    ["@cmd", "'@cmd"],
    ["-2+3", "'-2+3"],
    ["  =padded", "'=padded"],
    ["\tTAB", "'TAB"],
    ["\rCR", "'CR"],
  ])("prefixes formula-looking text %j with a quote", (input, expected) => {
    expect(csvCell(input)).toBe(expected);
  });

  it("leaves numbers and numeric text alone", () => {
    expect(csvCell(-3)).toBe("-3");
    expect(csvCell(0)).toBe("0");
    expect(csvCell("-1.50", { numeric: true })).toBe("-1.50");
  });

  it("quotes commas, quotes, line feeds and carriage returns", () => {
    expect(csvCell("Garcia, Marta")).toBe('"Garcia, Marta"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("a\nb")).toBe('"a\nb"');
    expect(csvCell("a\rb")).toBe('"a\rb"');
  });

  it("guards and quotes together", () => {
    expect(csvCell('=HYPERLINK("x"),1')).toBe('"\'=HYPERLINK(""x""),1"');
  });

  it("renders empty values as an empty cell", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell("   ")).toBe("");
  });

  it("keeps plain text unchanged", () => {
    expect(csvCell("Núria Puig·Llull")).toBe("Núria Puig·Llull");
    expect(sanitizeCsvValue("Marta")).toBe("Marta");
  });
});
