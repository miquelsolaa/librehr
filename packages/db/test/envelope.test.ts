import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import { encryptEnvelope, decryptEnvelope } from "../src/crypto/envelope.js";

describe("Envelope Encryption (AES-256-GCM)", () => {
  const masterKey = crypto.randomBytes(32);

  it("encrypts and decrypts sensitive string (e.g. IBAN, DNI/NIE)", () => {
    const sensitiveData = "ES9121000418450200051332";
    const encrypted = encryptEnvelope(sensitiveData, masterKey, "v1");

    expect(encrypted).not.toContain(sensitiveData);
    expect(encrypted).toContain("v1");

    const decrypted = decryptEnvelope(encrypted, masterKey);
    expect(decrypted).toBe(sensitiveData);
  });

  it("fails decryption with wrong master key", () => {
    const sensitiveData = "12345678Z";
    const encrypted = encryptEnvelope(sensitiveData, masterKey);
    const wrongKey = crypto.randomBytes(32);

    expect(() => decryptEnvelope(encrypted, wrongKey)).toThrow();
  });

  it("detects tampering with ciphertext", () => {
    const sensitiveData = "Secret";
    const encrypted = encryptEnvelope(sensitiveData, masterKey);
    const tampered = encrypted.replace(/"tag":"[^"]+"/, '"tag":"AAAA"');

    expect(() => decryptEnvelope(tampered, masterKey)).toThrow();
  });

  it("encrypts and decrypts with default environment key", () => {
    const sensitiveData = "12345678Z";
    const encrypted = encryptEnvelope(sensitiveData);
    const decrypted = decryptEnvelope(encrypted);
    expect(decrypted).toBe(sensitiveData);
  });
});
