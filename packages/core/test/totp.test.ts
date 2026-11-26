import crypto from "node:crypto";
import { describe, it, expect } from "vitest";
import {
  base32Encode,
  base32Decode,
  generateTotpSecret,
  generateTotpCode,
  verifyTotpCode,
  generateTotpUri,
  generateRecoveryCodes,
  verifyRecoveryCode,
  matchTotpStep,
  hashRecoveryCode,
} from "../src/identity/totp.js";

describe("TOTP replay support (AUTH-003)", () => {
  it("returns the matched time step within the drift window", () => {
    const secret = generateTotpSecret();
    const now = 1_800_000_000_000;
    const step = Math.floor(now / 30_000);
    expect(matchTotpStep(secret, generateTotpCode(secret, now), now)).toBe(
      step,
    );
    expect(
      matchTotpStep(secret, generateTotpCode(secret, now - 30_000), now),
    ).toBe(step - 1);
    expect(
      matchTotpStep(secret, generateTotpCode(secret, now + 30_000), now),
    ).toBe(step + 1);
    expect(
      matchTotpStep(secret, generateTotpCode(secret, now - 90_000), now),
    ).toBeNull();
    expect(matchTotpStep(secret, "12345", now)).toBeNull();
  });

  it("hashes recovery codes in the stored format", () => {
    const { plainCodes, hashedCodes } = generateRecoveryCodes(2);
    expect(hashRecoveryCode(` ${plainCodes[0]!.toUpperCase()} `)).toBe(
      hashedCodes[0],
    );
  });
});

describe("TOTP Two-Factor Authentication", () => {
  it("encodes and decodes base32 symmetrically", () => {
    const input = Buffer.from("Hello LibreHR 2FA", "utf-8");
    const encoded = base32Encode(input);
    const decoded = base32Decode(encoded);
    expect(decoded.toString("utf-8")).toBe("Hello LibreHR 2FA");
  });

  it("generates a valid 20-byte base32 secret", () => {
    const secret = generateTotpSecret();
    expect(secret.length).toBeGreaterThanOrEqual(32);
    const decoded = base32Decode(secret);
    expect(decoded.length).toBe(20);
  });

  it("generates and verifies 6-digit TOTP code within time window", () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    const code = generateTotpCode(secret, now);

    expect(code).toMatch(/^\d{6}$/);

    // Exact timestamp verification
    expect(verifyTotpCode(secret, code, now)).toBe(true);

    // Within +/- 30s window
    expect(verifyTotpCode(secret, code, now + 25000)).toBe(true);
    expect(verifyTotpCode(secret, code, now - 25000)).toBe(true);

    // Outside acceptable window (+90 seconds)
    expect(verifyTotpCode(secret, code, now + 90000, 1)).toBe(false);

    // Invalid code fails
    expect(verifyTotpCode(secret, "000000", now)).toBe(false);
  });

  it("formats standard otpauth URI", () => {
    const secret = "JBSWY3DPEHPK3PXP";
    const uri = generateTotpUri({
      secret,
      accountName: "admin@company.com",
      issuer: "LibreHR",
    });

    expect(uri).toContain("otpauth://totp/LibreHR%3Aadmin%40company.com");
    expect(uri).toContain(`secret=${secret}`);
    expect(uri).toContain("issuer=LibreHR");
  });

  it("generates and verifies single-use recovery codes", () => {
    const { plainCodes, hashedCodes } = generateRecoveryCodes(8);
    expect(plainCodes).toHaveLength(8);
    expect(hashedCodes).toHaveLength(8);

    const firstCode = plainCodes[0]!;
    expect(firstCode).toMatch(
      /^[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}$/,
    );

    // Verifying valid code returns index 0
    const matchedIdx = verifyRecoveryCode(firstCode, hashedCodes);
    expect(matchedIdx).toBe(0);

    // Verifying invalid code returns -1
    const invalidIdx = verifyRecoveryCode("0000-0000", hashedCodes);
    expect(invalidIdx).toBe(-1);
  });
  // CodeQL js/polynomial-redos: a regex trim of trailing "=" is quadratic on
  // long runs of "=" that do not end the string.
  it("rejects a long run of padding in linear time", () => {
    const hostile = `${"=".repeat(200_000)}A`;
    const started = performance.now();
    expect(() => base32Decode(hostile)).toThrow("Invalid Base32 character");
    expect(performance.now() - started).toBeLessThan(500);
  });

  it("still strips trailing padding and whitespace", () => {
    expect(base32Decode("MZXW6===")).toEqual(Buffer.from("foo"));
    expect(base32Decode("mzxw 6")).toEqual(Buffer.from("foo"));
  });
});

// Issue #35: recovery codes carry at least 64 bits each.
describe("recovery code entropy (AUTH-003)", () => {
  const FORMAT = /^[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}$/;

  it("formats every code as 16 hex characters (64 bits) in groups of four", () => {
    const { plainCodes } = generateRecoveryCodes(50);
    for (const code of plainCodes) {
      expect(code).toMatch(FORMAT);
      expect(code.replaceAll("-", "")).toHaveLength(16);
    }
  });

  it("produces distinct codes and uses every hex digit", () => {
    const { plainCodes, hashedCodes } = generateRecoveryCodes(200);
    expect(new Set(plainCodes).size).toBe(200);
    expect(new Set(hashedCodes).size).toBe(200);
    // 3,200 random hex digits: a missing digit would mean a biased encoder.
    const digits = new Set(plainCodes.join("").replaceAll("-", ""));
    expect(digits.size).toBe(16);
  });

  it("accepts a new-format code case-insensitively and with spaces", () => {
    const { plainCodes, hashedCodes } = generateRecoveryCodes(3);
    const code = plainCodes[2]!;
    expect(verifyRecoveryCode(` ${code.toUpperCase()} `, hashedCodes)).toBe(2);
    expect(hashRecoveryCode(code)).toBe(hashedCodes[2]);
  });

  it("still accepts a code issued in the old 'xxxx-xxxx' format", () => {
    // Stored the way earlier releases stored it: SHA-256 of the lower-cased code.
    const legacy = "a1b2-c3d4";
    const stored = [hashRecoveryCode("0f0f-0f0f"), hashRecoveryCode(legacy)];
    expect(verifyRecoveryCode(legacy, stored)).toBe(1);
    expect(verifyRecoveryCode("A1B2-C3D4", stored)).toBe(1);
    expect(verifyRecoveryCode("a1b2-c3d5", stored)).toBe(-1);
  });

  it("accepts both formats without dashes, with inner spaces or in upper case", () => {
    const { plainCodes, hashedCodes } = generateRecoveryCodes(1);
    const current = plainCodes[0]!;
    const compact = current.replaceAll("-", "");
    for (const typed of [
      compact,
      compact.toUpperCase(),
      current.replaceAll("-", " "),
      ` ${compact.slice(0, 8)} ${compact.slice(8).toUpperCase()} `,
      current.toUpperCase().replaceAll("-", " - "),
    ]) {
      expect(verifyRecoveryCode(typed, hashedCodes)).toBe(0);
    }

    // A legacy code stored by an earlier release as SHA-256 of "a1b2-c3d4".
    const legacyStored = [
      crypto.createHash("sha256").update("a1b2-c3d4").digest("hex"),
    ];
    for (const typed of [
      "a1b2c3d4",
      "A1B2C3D4",
      "a1b2 c3d4",
      " A1B2 - C3D4 ",
    ]) {
      expect(verifyRecoveryCode(typed, legacyStored)).toBe(0);
    }
    expect(verifyRecoveryCode("a1b2c3d", legacyStored)).toBe(-1);
  });

  it("hashes anything that is not 8 or 16 hex characters as before", () => {
    const sha = (text: string) =>
      crypto.createHash("sha256").update(text).digest("hex");
    expect(hashRecoveryCode(" Not-A-Code ")).toBe(sha("not-a-code"));
    expect(hashRecoveryCode("123456")).toBe(sha("123456"));
  });
});
