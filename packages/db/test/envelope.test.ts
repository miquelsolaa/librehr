import { describe, it, expect, afterEach, vi } from "vitest";
import crypto from "node:crypto";
import {
  configureEnvelopeKey,
  encryptEnvelope,
  decryptEnvelope,
  getMasterKeyFromEnv,
} from "../src/crypto/envelope.js";

describe("getMasterKeyFromEnv in production (DOC-004)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("throws when the master key is missing", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ENVELOPE_MASTER_KEY", "");
    expect(() => getMasterKeyFromEnv()).toThrow(/ENVELOPE_MASTER_KEY/);
  });

  it("throws when the master key is the known dev key (raw or base64)", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ENVELOPE_MASTER_KEY", "dev_envelope_master_key_for_local_dev");
    expect(() => getMasterKeyFromEnv()).toThrow(/ENVELOPE_MASTER_KEY/);
    vi.stubEnv(
      "ENVELOPE_MASTER_KEY",
      "ZGV2X2VudmVsb3BlX21hc3Rlcl9rZXlfZm9yX2xvY2FsX2Rldg==",
    );
    expect(() => getMasterKeyFromEnv()).toThrow(/ENVELOPE_MASTER_KEY/);
  });

  it("accepts a real 32-byte key", () => {
    vi.stubEnv("NODE_ENV", "production");
    const key = crypto.randomBytes(32);
    vi.stubEnv("ENVELOPE_MASTER_KEY", key.toString("base64"));
    expect(getMasterKeyFromEnv().equals(key)).toBe(true);
  });

  it("uses a configured key when the process env has none (Docker secrets)", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ENVELOPE_MASTER_KEY", "");
    const key = crypto.randomBytes(32);
    configureEnvelopeKey(key.toString("base64"));
    try {
      expect(getMasterKeyFromEnv().equals(key)).toBe(true);
    } finally {
      configureEnvelopeKey(undefined);
    }
  });

  it("ignores a configured dev key, so production still refuses it", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ENVELOPE_MASTER_KEY", "");
    configureEnvelopeKey(
      "ZGV2X2VudmVsb3BlX21hc3Rlcl9rZXlfZm9yX2xvY2FsX2Rldg==",
    );
    try {
      expect(() => getMasterKeyFromEnv()).toThrow(/ENVELOPE_MASTER_KEY/);
    } finally {
      configureEnvelopeKey(undefined);
    }
  });

  it("keeps the dev fallback outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ENVELOPE_MASTER_KEY", "");
    expect(getMasterKeyFromEnv()).toHaveLength(32);
  });
});

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
