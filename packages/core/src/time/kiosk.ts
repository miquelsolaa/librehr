import crypto from "node:crypto";

/**
 * Kiosk PIN hashing (TIM-010).
 *
 * Current format: `scrypt$<salt hex>$<key hex>` in `pin_hash`, with the same
 * parameters as account passwords (16-byte salt, 64-byte key, Node defaults
 * N=16384, r=8, p=1). The separate `pin_salt` column is only used by the
 * legacy format, a single salted SHA-256, which is still accepted so existing
 * PINs keep working and are upgraded on their next successful use.
 */
const KEY_LENGTH = 64;
const SCRYPT_FORMAT = /^scrypt\$([0-9a-f]{32})\$([0-9a-f]{128})$/;
const LEGACY_FORMAT = /^[0-9a-f]{64}$/;

function scryptAsync(pin: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(pin, salt, KEY_LENGTH, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

/**
 * Hashes a kiosk PIN with scrypt and a fresh random salt.
 *
 * @example
 * const stored = await hashKioskPin("4821"); // "scrypt$<32 hex>$<128 hex>"
 */
export async function hashKioskPin(pin: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString("hex");
  const key = await scryptAsync(pin, salt);
  return `scrypt$${salt}$${key.toString("hex")}`;
}

/** Legacy single salted SHA-256; kept only to verify PINs set before scrypt. */
function legacyKioskPinHash(pin: string, salt: string): string {
  return crypto
    .createHash("sha256")
    .update(`${salt}:${pin}`, "utf-8")
    .digest("hex");
}

export interface KioskPinCheck {
  valid: boolean;
  /** True when the PIN matched a legacy hash and should be re-stored with scrypt. */
  needsRehash: boolean;
}

function safeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

/**
 * Verifies a kiosk PIN against a stored hash in either format, in constant
 * time for a given format.
 *
 * @example
 * await verifyKioskPin("4821", stored, null); // { valid: true, needsRehash: false }
 * await verifyKioskPin("4821", legacyHex, legacySalt); // { valid: true, needsRehash: true }
 */
export async function verifyKioskPin(
  pin: string,
  storedHash: string | null,
  legacySalt: string | null,
): Promise<KioskPinCheck> {
  const invalid = { valid: false, needsRehash: false };
  if (!pin || !storedHash) return invalid;

  const scryptMatch = SCRYPT_FORMAT.exec(storedHash);
  if (scryptMatch) {
    const [, salt, expected] = scryptMatch;
    const actual = await scryptAsync(pin, salt!);
    return {
      valid: safeEqualHex(actual.toString("hex"), expected!),
      needsRehash: false,
    };
  }

  if (legacySalt && LEGACY_FORMAT.test(storedHash)) {
    const valid = safeEqualHex(legacyKioskPinHash(pin, legacySalt), storedHash);
    return { valid, needsRehash: valid };
  }

  return invalid;
}

/** Test helper: builds a legacy-format PIN hash, as rows written before scrypt hold. */
export function legacyKioskPinHashForTests(pin: string, salt: string): string {
  return legacyKioskPinHash(pin, salt);
}
