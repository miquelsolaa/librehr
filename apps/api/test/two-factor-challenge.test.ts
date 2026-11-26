import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CHALLENGE_TTL_MS,
  challengeSecret,
  createChallengeToken,
  verifyChallengeToken,
} from "../src/lib/two-factor-challenge.js";

const secret = "a-secure-test-secret-with-at-least-32-characters";
const userId = "c7000000-0000-0000-0000-00000000000c";
const organizationId = "a7000000-0000-0000-0000-00000000000a";

describe("2FA challenge tokens (AUTH-003, AUTH-004)", () => {
  it("round-trips the user, and the organization only when given", () => {
    const plain = createChallengeToken({ userId }, secret);
    expect(verifyChallengeToken(plain, secret)).toEqual({ userId });

    const pinned = createChallengeToken({ userId, organizationId }, secret);
    expect(verifyChallengeToken(pinned, secret)).toEqual({
      userId,
      organizationId,
    });
  });

  it("expires after the TTL", () => {
    const now = 1_800_000_000_000;
    const token = createChallengeToken({ userId }, secret, now);
    expect(verifyChallengeToken(token, secret, now + CHALLENGE_TTL_MS)).toEqual(
      { userId },
    );
    expect(
      verifyChallengeToken(token, secret, now + CHALLENGE_TTL_MS + 1),
    ).toBeNull();
  });

  it("refuses a token whose payload was changed (e.g. another organization)", () => {
    const token = createChallengeToken({ userId, organizationId }, secret);
    const [, signature] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({
        userId,
        organizationId: "b7000000-0000-0000-0000-00000000000b",
        exp: Date.now() + CHALLENGE_TTL_MS,
      }),
    ).toString("base64url");
    expect(verifyChallengeToken(`${forged}.${signature}`, secret)).toBeNull();
  });

  it.each([
    ["no secret", null],
    ["another secret", "another-secure-secret-with-32-plus-characters"],
  ])("refuses with %s", (_label, other) => {
    const token = createChallengeToken({ userId }, secret);
    expect(verifyChallengeToken(token, other)).toBeNull();
  });

  it.each(["", "abc", "a.b.c", "x.", ".y", "eyJ9.short"])(
    "refuses the malformed token %j",
    (token) => {
      expect(verifyChallengeToken(token, secret)).toBeNull();
    },
  );

  it("refuses a validly signed payload of the wrong shape", () => {
    // Signed with the right key, but without a string userId.
    const payload = Buffer.from(
      JSON.stringify({ exp: Date.now() + 1000 }),
    ).toString("base64url");
    const sig = createHmac("sha256", secret)
      .update(payload)
      .digest("base64url");
    expect(verifyChallengeToken(`${payload}.${sig}`, secret)).toBeNull();
  });

  it("accepts only secrets of at least 32 characters", () => {
    expect(challengeSecret(undefined)).toBeNull();
    expect(challengeSecret("short")).toBeNull();
    expect(challengeSecret(secret)).toBe(secret);
  });
});
