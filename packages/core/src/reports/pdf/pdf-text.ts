import { textWidth, type PdfFont } from "./helvetica-metrics.js";
import { WIN_ANSI_ELLIPSIS } from "./winansi.js";

/** Cuts WinAnsi text to a width, ending in an ellipsis when it was cut. */
export function fit(
  bytes: string,
  font: PdfFont,
  size: number,
  max: number,
): string {
  if (textWidth(bytes, font, size) <= max) return bytes;
  const ellipsis = String.fromCharCode(WIN_ANSI_ELLIPSIS);
  let cut = bytes;
  while (cut.length > 0 && textWidth(cut + ellipsis, font, size) > max) {
    cut = cut.slice(0, -1);
  }
  return cut.trimEnd() + ellipsis;
}

/** Greedy word wrap into at most `maxLines` lines; the last one is cut. */
export function wrap(
  bytes: string,
  font: PdfFont,
  size: number,
  max: number,
  maxLines: number,
): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of bytes.split(" ")) {
    const candidate = current === "" ? word : `${current} ${word}`;
    if (current === "" || textWidth(candidate, font, size) <= max) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  lines.push(current);
  const kept = lines.slice(0, maxLines);
  if (lines.length > maxLines) kept[maxLines - 1] += ` ${lines[maxLines]}`;
  return kept.map((line) => fit(line, font, size, max));
}
