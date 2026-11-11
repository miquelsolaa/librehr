/**
 * Removes every trailing occurrence of `char` from `value`.
 *
 * A loop instead of `replace(/x+$/, "")`: that regex backtracks from every
 * position of a long run that does not end the string, which is quadratic
 * (CodeQL js/polynomial-redos).
 *
 * @example trimTrailing("https://idp.example///", "/") // "https://idp.example"
 */
export function trimTrailing(value: string, char: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === char) end -= 1;
  return value.slice(0, end);
}
