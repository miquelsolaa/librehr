const DNI_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE";

export type SpanishIdType = "dni" | "nie" | "cif";

export interface SpanishIdValidationResult {
  valid: boolean;
  type?: SpanishIdType;
  formatted?: string;
  error?: string;
}

export function normalizeSpanishId(raw: string): string {
  return raw.replace(/[\s\-_.]/g, "").toUpperCase();
}

/**
 * Validates a Spanish DNI (Documento Nacional de Identidad).
 * Format: 8 numeric digits followed by 1 control letter calculated via modulo 23.
 */
export function validateDni(cleaned: string): boolean {
  if (!/^\d{8}[A-Z]$/.test(cleaned)) {
    return false;
  }
  const digits = parseInt(cleaned.slice(0, 8), 10);
  const letter = cleaned.charAt(8);
  const expectedLetter = DNI_LETTERS.charAt(digits % 23);
  return letter === expectedLetter;
}

/**
 * Validates a Spanish NIE (Número de Identidad de Extranjero).
 * Format: X, Y, or Z followed by 7 digits and 1 control letter.
 * X is mapped to 0, Y to 1, Z to 2 for modulo 23 check.
 */
export function validateNie(cleaned: string): boolean {
  if (!/^[XYZ]\d{7}[A-Z]$/.test(cleaned)) {
    return false;
  }
  const prefix = cleaned.charAt(0);
  const prefixMap: Record<string, string> = { X: "0", Y: "1", Z: "2" };
  const prefixDigit = prefixMap[prefix];
  if (!prefixDigit) return false;

  const numericString = `${prefixDigit}${cleaned.slice(1, 8)}`;
  const digits = parseInt(numericString, 10);
  const letter = cleaned.charAt(8);
  const expectedLetter = DNI_LETTERS.charAt(digits % 23);
  return letter === expectedLetter;
}

/**
 * Validates a Spanish CIF (Código de Identificación Fiscal) for legal entities.
 */
export function validateCif(cleaned: string): boolean {
  if (!/^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/.test(cleaned)) {
    return false;
  }

  const digits = cleaned.slice(1, 8);
  let evenSum = 0;
  let oddSum = 0;

  for (let i = 0; i < digits.length; i++) {
    const n = parseInt(digits.charAt(i), 10);
    if ((i + 1) % 2 === 0) {
      evenSum += n;
    } else {
      const double = n * 2;
      oddSum += double > 9 ? double - 9 : double;
    }
  }

  const totalSum = evenSum + oddSum;
  const unit = totalSum % 10;
  const controlDigit = unit === 0 ? 0 : 10 - unit;
  const controlLetter = "JABCDEFGHI".charAt(controlDigit);

  const lastChar = cleaned.charAt(8);
  const firstChar = cleaned.charAt(0);

  // Entities where control must be a letter
  if ("KPQRSNW".includes(firstChar)) {
    return lastChar === controlLetter;
  }
  // Entities where control must be a number
  if ("ABEH".includes(firstChar)) {
    return lastChar === String(controlDigit);
  }
  // Entities allowing either
  return lastChar === String(controlDigit) || lastChar === controlLetter;
}

/**
 * Validates any Spanish identification document (DNI, NIE, or CIF).
 */
export function validateSpanishId(rawId: string): SpanishIdValidationResult {
  const cleaned = normalizeSpanishId(rawId);
  if (!cleaned) {
    return { valid: false, error: "Empty ID provided" };
  }

  if (/^\d{8}[A-Z]$/.test(cleaned)) {
    const valid = validateDni(cleaned);
    return valid
      ? { valid: true, type: "dni", formatted: cleaned }
      : { valid: false, type: "dni", error: "Invalid DNI control letter" };
  }

  if (/^[XYZ]\d{7}[A-Z]$/.test(cleaned)) {
    const valid = validateNie(cleaned);
    return valid
      ? { valid: true, type: "nie", formatted: cleaned }
      : { valid: false, type: "nie", error: "Invalid NIE control letter" };
  }

  if (/^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/.test(cleaned)) {
    const valid = validateCif(cleaned);
    return valid
      ? { valid: true, type: "cif", formatted: cleaned }
      : { valid: false, type: "cif", error: "Invalid CIF check digit" };
  }

  return { valid: false, error: "Unrecognized Spanish identification format" };
}
