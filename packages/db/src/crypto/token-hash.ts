import crypto from "node:crypto";

/**
 * Storage form of a bearer secret (session token, invitation token): the
 * SHA-256 hex digest. Only the digest is written to the database, so a leaked
 * row or backup cannot be replayed as a live session or invitation link. The
 * raw tokens carry 256 bits of randomness, so an unsalted fast hash is enough.
 * Migration 0026 applies the same transform to rows stored in plain text.
 */
export function hashBearerToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken, "utf8").digest("hex");
}
