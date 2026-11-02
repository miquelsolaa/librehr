import { describe, expect, it } from "vitest";
import {
  generateWebhookSecret,
  signWebhookPayload,
  verifyWebhookSignature,
  WEBHOOK_EVENTS,
} from "../src/webhooks/index.js";

describe("Webhooks Domain Engine", () => {
  it("defines standard webhook event types", () => {
    expect(WEBHOOK_EVENTS).toContain("employee.created");
    expect(WEBHOOK_EVENTS).toContain("leave.approved");
    expect(WEBHOOK_EVENTS).toContain("test.ping");
  });

  it("generates a random whsec_ prefixed secret", () => {
    const s1 = generateWebhookSecret();
    const s2 = generateWebhookSecret();

    expect(s1).toMatch(/^whsec_[a-f0-9]{48}$/);
    expect(s2).toMatch(/^whsec_[a-f0-9]{48}$/);
    expect(s1).not.toBe(s2);
  });

  it("signs payload and creates signature header", () => {
    const payload = JSON.stringify({
      event: "employee.created",
      id: "emp_123",
    });
    const secret = "whsec_test_secret_1234567890abcdef";
    const ts = 1700000000;

    const { signature, header, timestamp } = signWebhookPayload(
      payload,
      secret,
      ts,
    );

    expect(timestamp).toBe(ts);
    expect(signature).toHaveLength(64); // sha256 hex length
    expect(header).toBe(`t=${ts},v1=${signature}`);
  });

  it("verifies a valid signature successfully within tolerance", () => {
    const payload = JSON.stringify({ event: "test.ping", pingId: "ping_1" });
    const secret = "whsec_valid_secret";
    const now = Math.floor(Date.now() / 1000);

    const { header } = signWebhookPayload(payload, secret, now);

    const isValid = verifyWebhookSignature(payload, header, secret, 300);
    expect(isValid).toBe(true);
  });

  it("rejects mismatched secret", () => {
    const payload = JSON.stringify({ event: "leave.requested" });
    const secretA = "whsec_secret_a";
    const secretB = "whsec_secret_b";
    const now = Math.floor(Date.now() / 1000);

    const { header } = signWebhookPayload(payload, secretA, now);

    const isValid = verifyWebhookSignature(payload, header, secretB, 300);
    expect(isValid).toBe(false);
  });

  it("rejects tampered payload", () => {
    const payload = JSON.stringify({ amount: 100 });
    const tampered = JSON.stringify({ amount: 999 });
    const secret = "whsec_secret";
    const now = Math.floor(Date.now() / 1000);

    const { header } = signWebhookPayload(payload, secret, now);

    const isValid = verifyWebhookSignature(tampered, header, secret, 300);
    expect(isValid).toBe(false);
  });

  it("rejects expired timestamp beyond tolerance", () => {
    const payload = JSON.stringify({ event: "test" });
    const secret = "whsec_secret";
    const oldTimestamp = Math.floor(Date.now() / 1000) - 600; // 10 minutes ago

    const { header } = signWebhookPayload(payload, secret, oldTimestamp);

    // Tolerance is 300s (5 minutes)
    const isValid = verifyWebhookSignature(payload, header, secret, 300);
    expect(isValid).toBe(false);
  });

  it("gracefully returns false on malformed headers", () => {
    const payload = "test";
    const secret = "whsec_secret";

    expect(verifyWebhookSignature(payload, "", secret)).toBe(false);
    expect(verifyWebhookSignature(payload, "invalid_header", secret)).toBe(
      false,
    );
    expect(verifyWebhookSignature(payload, "t=invalid,v1=123", secret)).toBe(
      false,
    );
  });
});
