import crypto from "node:crypto";

/** How long a 2FA challenge stays valid after the first factor passed. */
export const CHALLENGE_TTL_MS = 5 * 60 * 1000;

/**
 * The signing key for challenge tokens (SESSION_SECRET), or null when it is
 * missing or too short: 2FA challenges are then refused, never signed with
 * a weak key.
 */
export function challengeSecret(value: string | undefined): string | null {
  return value && value.length >= 32 ? value : null;
}

/** What a valid challenge token proves: who passed the first factor. */
export interface TwoFactorChallenge {
  userId: string;
  /**
   * The organization the first factor was for (SSO: the configuration's
   * organization), so the session opened after the second factor stays
   * pinned to it. Absent after password sign-in: default membership.
   */
  organizationId?: string | undefined;
}

/**
 * Signs a short-lived token handed to the client between the first factor
 * (password or SSO) and the TOTP step (AUTH-003). HMAC-SHA256 over the
 * base64url payload; the token holds no secret, only ids and an expiry.
 */
export function createChallengeToken(
  challenge: TwoFactorChallenge,
  secret: string,
  now: number = Date.now(),
): string {
  const payload = JSON.stringify({
    userId: challenge.userId,
    ...(challenge.organizationId
      ? { organizationId: challenge.organizationId }
      : {}),
    exp: now + CHALLENGE_TTL_MS,
  });
  const b64Payload = Buffer.from(payload).toString("base64url");
  const signature = crypto
    .createHmac("sha256", secret)
    .update(b64Payload)
    .digest("base64url");
  return `${b64Payload}.${signature}`;
}

/**
 * Returns the challenge a token was signed for, or null when it is
 * malformed, tampered with, expired or no secret is configured.
 */
export function verifyChallengeToken(
  token: string,
  secret: string | null,
  now: number = Date.now(),
): TwoFactorChallenge | null {
  try {
    if (!secret) return null;
    const parts = token.split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
    const [b64Payload, signature] = parts;

    const expected = Buffer.from(
      crypto
        .createHmac("sha256", secret)
        .update(b64Payload)
        .digest("base64url"),
    );
    const given = Buffer.from(signature);
    // timingSafeEqual throws on a length mismatch; refuse first instead.
    if (given.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(given, expected)) return null;

    const payload: unknown = JSON.parse(
      Buffer.from(b64Payload, "base64url").toString("utf-8"),
    );
    if (typeof payload !== "object" || payload === null) return null;
    const { userId, organizationId, exp } = payload as Record<string, unknown>;
    if (typeof userId !== "string" || typeof exp !== "number") return null;
    if (now > exp) return null;
    return typeof organizationId === "string"
      ? { userId, organizationId }
      : { userId };
  } catch {
    return null;
  }
}
