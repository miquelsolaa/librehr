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
} from "../src/identity/totp.js";

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
    expect(firstCode).toMatch(/^[0-9a-f]{4}-[0-9a-f]{4}$/);

    // Verifying valid code returns index 0
    const matchedIdx = verifyRecoveryCode(firstCode, hashedCodes);
    expect(matchedIdx).toBe(0);

    // Verifying invalid code returns -1
    const invalidIdx = verifyRecoveryCode("0000-0000", hashedCodes);
    expect(invalidIdx).toBe(-1);
  });
});
