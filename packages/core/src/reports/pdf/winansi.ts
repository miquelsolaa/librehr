/** Unicode code points WinAnsiEncoding places in its 0x80..0x9F range. */
const WIN_ANSI_SPECIALS: ReadonlyMap<number, number> = new Map([
  [0x20ac, 0x80], // €
  [0x201a, 0x82], // ‚
  [0x0192, 0x83], // ƒ
  [0x201e, 0x84], // „
  [0x2026, 0x85], // …
  [0x2020, 0x86], // †
  [0x2021, 0x87], // ‡
  [0x02c6, 0x88], // ˆ
  [0x2030, 0x89], // ‰
  [0x0160, 0x8a], // Š
  [0x2039, 0x8b], // ‹
  [0x0152, 0x8c], // Œ
  [0x017d, 0x8e], // Ž
  [0x2018, 0x91], // ‘
  [0x2019, 0x92], // ’
  [0x201c, 0x93], // “
  [0x201d, 0x94], // ”
  [0x2022, 0x95], // •
  [0x2013, 0x96], // –
  [0x2014, 0x97], // —
  [0x02dc, 0x98], // ˜
  [0x2122, 0x99], // ™
  [0x0161, 0x9a], // š
  [0x203a, 0x9b], // ›
  [0x0153, 0x9c], // œ
  [0x017e, 0x9e], // ž
  [0x0178, 0x9f], // Ÿ
]);

/** WinAnsi byte of the horizontal ellipsis, used when truncating text. */
export const WIN_ANSI_ELLIPSIS = 0x85;

function winAnsiByte(codePoint: number): number {
  if (codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d) {
    return 0x20; // whitespace controls become a space
  }
  if (codePoint >= 0x20 && codePoint <= 0x7e) return codePoint;
  if (codePoint >= 0xa0 && codePoint <= 0xff) return codePoint;
  return WIN_ANSI_SPECIALS.get(codePoint) ?? 0x3f; // "?"
}

/**
 * Text as a WinAnsi "binary string": one char per byte (char codes 0..255).
 * Latin-1 letters and the WinAnsi punctuation (€, …, –, curly quotes) map to
 * their byte; tab and line breaks become spaces; anything else (other
 * controls, emoji, non-Latin scripts) becomes `?`, one per code point.
 *
 * @example
 * winAnsiBinaryString("Lluís…"); // => "Lluís\u0085"
 */
export function winAnsiBinaryString(text: string): string {
  let out = "";
  for (const char of text) {
    out += String.fromCharCode(winAnsiByte(char.codePointAt(0) ?? 0x3f));
  }
  return out;
}

/**
 * Text encoded as WinAnsiEncoding bytes (see {@link winAnsiBinaryString}).
 *
 * @example
 * encodeWinAnsi("ç·😀"); // => Uint8Array [0xe7, 0xb7, 0x3f]
 */
export function encodeWinAnsi(text: string): Uint8Array {
  return binaryStringToBytes(winAnsiBinaryString(text));
}

/**
 * Bytes of a binary string (each char code must be 0..255).
 *
 * @example
 * binaryStringToBytes("%PDF"); // => Uint8Array [0x25, 0x50, 0x44, 0x46]
 */
export function binaryStringToBytes(binary: string): Uint8Array {
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * A WinAnsi binary string as a PDF literal string, with `\`, `(` and `)`
 * escaped.
 *
 * @example
 * pdfLiteral("a(b)\\c"); // => "(a\\(b\\)\\\\c)"
 */
export function pdfLiteral(binary: string): string {
  return `(${binary.replace(/[\\()]/g, (match) => `\\${match}`)})`;
}
