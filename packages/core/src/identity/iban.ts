export interface IbanValidationResult {
  valid: boolean;
  formatted?: string;
  countryCode?: string;
  error?: string;
}

const IBAN_LENGTHS: Record<string, number> = {
  ES: 24,
  AD: 24,
  DE: 22,
  FR: 27,
  IT: 27,
  PT: 25,
  GB: 22,
  NL: 18,
  BE: 16,
  CH: 21,
  AT: 20,
  IE: 22,
};

export function normalizeIban(raw: string): string {
  return raw.replace(/[\s\-_.]/g, "").toUpperCase();
}

/**
 * Calculates modulo 97 on a long numeric string in chunks to avoid JS integer overflow.
 */
function modulo97(numericString: string): number {
  let remainder = 0;
  for (let i = 0; i < numericString.length; i += 7) {
    const chunk = String(remainder) + numericString.slice(i, i + 7);
    remainder = parseInt(chunk, 10) % 97;
  }
  return remainder;
}

/**
 * Validates an International Bank Account Number (IBAN) per ISO 13616 and MOD 97-10.
 */
export function validateIban(rawIban: string): IbanValidationResult {
  const cleaned = normalizeIban(rawIban);

  if (!cleaned) {
    return { valid: false, error: "Empty IBAN provided" };
  }

  // Must begin with 2 letters and 2 digits
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(cleaned)) {
    return { valid: false, error: "Malformed IBAN format" };
  }

  const countryCode = cleaned.slice(0, 2);
  const expectedLength = IBAN_LENGTHS[countryCode];

  if (expectedLength && cleaned.length !== expectedLength) {
    return {
      valid: false,
      countryCode,
      error: `Invalid length for ${countryCode} IBAN (expected ${expectedLength}, got ${cleaned.length})`,
    };
  }

  // Rearrange: move the first 4 characters to the end
  const rearranged = cleaned.slice(4) + cleaned.slice(0, 4);

  // Convert letters to digits: A=10, B=11, ..., Z=35
  let numericString = "";
  for (let i = 0; i < rearranged.length; i++) {
    const code = rearranged.charCodeAt(i);
    if (code >= 65 && code <= 90) {
      numericString += String(code - 55);
    } else {
      numericString += rearranged.charAt(i);
    }
  }

  // Check modulo 97 == 1
  const mod = modulo97(numericString);
  if (mod !== 1) {
    return {
      valid: false,
      countryCode,
      error: "Invalid IBAN checksum",
    };
  }

  // Format in standard 4-character blocks
  const formatted = cleaned.match(/.{1,4}/g)?.join(" ") ?? cleaned;

  return {
    valid: true,
    countryCode,
    formatted,
  };
}
