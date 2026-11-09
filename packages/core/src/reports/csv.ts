/** Options for {@link csvCell} and {@link sanitizeCsvValue}. */
export interface CsvCellOptions {
  /**
   * The value is a number rendered as text (e.g. `"-1.50"`): skip the
   * formula-injection guard so negative numbers stay numeric.
   */
  numeric?: boolean | undefined;
}

export type CsvValue = string | number | null | undefined;

/**
 * Text of a CSV value before RFC 4180 quoting: trimmed, and with a leading `'`
 * when a spreadsheet would read a text value as a formula (it starts with
 * `=`, `+`, `@` or `-`, or with a tab or carriage return). Numbers and values
 * marked `numeric` are never prefixed.
 *
 * @example
 * sanitizeCsvValue("=HYPERLINK(1)"); // => "'=HYPERLINK(1)"
 * sanitizeCsvValue(-3); // => "-3"
 * sanitizeCsvValue("-1.50", { numeric: true }); // => "-1.50"
 */
export function sanitizeCsvValue(
  value: CsvValue,
  options: CsvCellOptions = {},
): string {
  const raw = String(value ?? "");
  const text = raw.trim();
  const looksLikeFormula = /^[=+@-]/.test(text) || /^[\t\r]/.test(raw);
  if (typeof value === "string" && !options.numeric && looksLikeFormula) {
    return `'${text}`;
  }
  return text;
}

/**
 * One RFC 4180 CSV cell: the {@link sanitizeCsvValue sanitized} text, wrapped
 * in double quotes (with inner quotes doubled) when it contains a comma, a
 * double quote, a line feed or a carriage return.
 *
 * @example
 * csvCell('Garcia, "Marta"'); // => '"Garcia, ""Marta"""'
 * csvCell("@cmd"); // => "'@cmd"
 * csvCell(42); // => "42"
 */
export function csvCell(value: CsvValue, options: CsvCellOptions = {}): string {
  const text = sanitizeCsvValue(value, options);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}
