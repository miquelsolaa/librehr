import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { describe, it, expect, afterEach, vi } from "vitest";
import {
  configureEnvelopeKey,
  decryptEnvelope,
  encryptEnvelope,
} from "@librehr/db";
import { loadEnv } from "../src/env.js";

// Values are generated for the test only; they are not dev defaults.
const prodEnv = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://librehr_app:Zq8vT2mN4rK7pL1x@db:5432/librehr",
  DATABASE_MIGRATION_URL:
    "postgres://librehr_owner:Hc3wY9bF6jD2sQ5u@db:5432/librehr",
  BETTER_AUTH_SECRET: "prod-auth-secret-7f3a9c1e5b2d8f4a6c0e9b7d",
  BETTER_AUTH_URL: "https://api.example.test",
  APP_URL: "https://hr.example.test",
  SESSION_SECRET: "prod-session-secret-4e8b2a6f0c9d3e7a1b5f",
  TIME_CHAIN_KEY: "prod-time-chain-key-9d1c5f3a7e2b6d0c4a8f",
};

describe("envelope master key from ENVELOPE_MASTER_KEY_FILE (DOC-004)", () => {
  let dir: string | undefined;

  afterEach(() => {
    configureEnvelopeKey(undefined);
    vi.unstubAllEnvs();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("encrypts and decrypts in production when only the _FILE variant is set", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "librehr-key-"));
    const keyFile = path.join(dir, "envelope_master_key");
    const key = crypto.randomBytes(32);
    fs.writeFileSync(keyFile, `${key.toString("base64")}\n`);

    // The process env carries no key at all, exactly as with Docker secrets.
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ENVELOPE_MASTER_KEY", "");

    const env = loadEnv({ ...prodEnv, ENVELOPE_MASTER_KEY_FILE: keyFile });
    configureEnvelopeKey(env.ENVELOPE_MASTER_KEY);

    const encrypted = encryptEnvelope("ES9121000418450200051332");
    expect(decryptEnvelope(encrypted)).toBe("ES9121000418450200051332");
    // The file key, not a fallback, was used.
    expect(decryptEnvelope(encrypted, key)).toBe("ES9121000418450200051332");
  });

  it("still refuses to encrypt in production when no key was configured", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ENVELOPE_MASTER_KEY", "");
    expect(() => encryptEnvelope("x")).toThrow(/ENVELOPE_MASTER_KEY/);
  });
});
