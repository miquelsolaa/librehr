import crypto from "node:crypto";

/**
 * Generates a random cryptographic salt for PIN hashing.
 */
export function generatePinSalt(): string {
  return crypto.randomBytes(16).toString("hex");
}

/**
 * Computes salted SHA-256 hash for kiosk PIN storage.
 */
export function hashKioskPin(pin: string, salt: string): string {
  const combined = `${salt}:${pin}`;
  return crypto.createHash("sha256").update(combined, "utf-8").digest("hex");
}

/**
 * Constant-time PIN verification to mitigate timing side-channel attacks.
 */
export function verifyKioskPin(
  pin: string,
  storedHash: string,
  salt: string,
): boolean {
  if (!storedHash || !salt || !pin) return false;
  const computed = hashKioskPin(pin, salt);
  try {
    const computedBuf = Buffer.from(computed, "hex");
    const storedBuf = Buffer.from(storedHash, "hex");
    if (computedBuf.length !== storedBuf.length) return false;
    return crypto.timingSafeEqual(computedBuf, storedBuf);
  } catch {
    return false;
  }
}
