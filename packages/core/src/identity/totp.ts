import crypto from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/**
 * Encodes a buffer to RFC 4648 Base32 string (without padding).
 */
export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";

  for (let i = 0; i < buffer.length; i++) {
    const byte = buffer[i]!;
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

/**
 * Decodes an RFC 4648 Base32 string into a Buffer.
 */
export function base32Decode(input: string): Buffer {
  const cleanInput = input.toUpperCase().replace(/=+$/, "").replace(/\s+/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (let i = 0; i < cleanInput.length; i++) {
    const char = cleanInput[i]!;
    const val = BASE32_ALPHABET.indexOf(char);
    if (val === -1) {
      throw new Error(`Invalid Base32 character: ${char}`);
    }

    value = (value << 5) | val;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

/**
 * Generates a cryptographically random 20-byte Base32 secret for TOTP.
 */
export function generateTotpSecret(): string {
  const randomBytes = crypto.randomBytes(20);
  return base32Encode(randomBytes);
}

/**
 * Computes the 6-digit TOTP code for a secret at a specific counter value (RFC 6238).
 */
export function computeTotpCode(secretBase32: string, counter: number): string {
  const key = base32Decode(secretBase32);
  const counterBuffer = Buffer.alloc(8);
  // Big-endian 64-bit integer
  counterBuffer.writeBigUInt64BE(BigInt(counter), 0);

  const hmac = crypto.createHmac("sha1", key).update(counterBuffer).digest();

  // Dynamic truncation (RFC 4226)
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const codeInt =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);

  const otp = codeInt % 1000000;
  return otp.toString().padStart(6, "0");
}

/**
 * Generates current TOTP code based on current timestamp and 30-second window.
 */
export function generateTotpCode(
  secretBase32: string,
  timestampMs: number = Date.now(),
): string {
  const counter = Math.floor(timestampMs / 1000 / 30);
  return computeTotpCode(secretBase32, counter);
}

/**
 * Returns the 30-second time step a TOTP code matches within the allowed
 * clock drift (+/- `windowSteps`), or null. Callers store the accepted step
 * and refuse the same or an earlier one, so a code cannot be replayed.
 *
 * @example
 * const step = matchTotpStep(secret, "123456");
 * if (step !== null && step > lastAcceptedStep) accept(step);
 */
export function matchTotpStep(
  secretBase32: string,
  code: string,
  timestampMs: number = Date.now(),
  windowSteps = 1,
): number | null {
  if (!code || code.length !== 6 || !/^\d{6}$/.test(code)) {
    return null;
  }

  const currentCounter = Math.floor(timestampMs / 1000 / 30);

  for (let offset = -windowSteps; offset <= windowSteps; offset++) {
    const step = currentCounter + offset;
    const expected = computeTotpCode(secretBase32, step);
    if (crypto.timingSafeEqual(Buffer.from(code), Buffer.from(expected))) {
      return step;
    }
  }

  return null;
}

/**
 * Verifies a TOTP code against a secret allowing clock drift (+/- window
 * intervals). Does not prevent replay; see {@link matchTotpStep}.
 */
export function verifyTotpCode(
  secretBase32: string,
  code: string,
  timestampMs: number = Date.now(),
  windowSteps = 1,
): boolean {
  return matchTotpStep(secretBase32, code, timestampMs, windowSteps) !== null;
}

/**
 * Stored form of a recovery code: hex SHA-256 of the trimmed, lower-cased
 * code (the format {@link generateRecoveryCodes} produces).
 *
 * @example
 * hashRecoveryCode(" ABCD-1234 ") === hashRecoveryCode("abcd-1234"); // true
 */
export function hashRecoveryCode(code: string): string {
  return crypto
    .createHash("sha256")
    .update(code.trim().toLowerCase())
    .digest("hex");
}

/**
 * Formats an otpauth URI for QR code generation.
 */
export function generateTotpUri(params: {
  secret: string;
  accountName: string;
  issuer?: string;
}): string {
  const issuer = params.issuer ?? "LibreHR";
  const label = encodeURIComponent(`${issuer}:${params.accountName}`);
  return `otpauth://totp/${label}?secret=${params.secret}&issuer=${encodeURIComponent(
    issuer,
  )}&algorithm=SHA1&digits=6&period=30`;
}

/**
 * Generates 8 random single-use recovery codes formatted as 'xxxx-xxxx'.
 */
export function generateRecoveryCodes(count = 8): {
  plainCodes: string[];
  hashedCodes: string[];
} {
  const plainCodes: string[] = [];
  const hashedCodes: string[] = [];

  for (let i = 0; i < count; i++) {
    const raw = crypto.randomBytes(4).toString("hex"); // 8 hex characters
    const formatted = `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
    plainCodes.push(formatted);

    const hash = crypto
      .createHash("sha256")
      .update(formatted.trim().toLowerCase())
      .digest("hex");
    hashedCodes.push(hash);
  }

  return { plainCodes, hashedCodes };
}

/**
 * Verifies and burns a recovery code against stored hashed recovery codes.
 * Returns the matching hash index if valid, or -1 if invalid.
 */
export function verifyRecoveryCode(
  inputCode: string,
  hashedCodes: string[],
): number {
  if (!inputCode) return -1;
  const normalized = inputCode.trim().toLowerCase();
  const inputHash = crypto
    .createHash("sha256")
    .update(normalized)
    .digest("hex");
  const inputHashBuf = Buffer.from(inputHash, "hex");

  for (let i = 0; i < hashedCodes.length; i++) {
    const storedHash = hashedCodes[i];
    if (!storedHash) continue;
    try {
      const storedHashBuf = Buffer.from(storedHash, "hex");
      if (
        storedHashBuf.length === inputHashBuf.length &&
        crypto.timingSafeEqual(inputHashBuf, storedHashBuf)
      ) {
        return i;
      }
    } catch {
      continue;
    }
  }

  return -1;
}
