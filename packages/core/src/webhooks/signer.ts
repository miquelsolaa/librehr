import crypto from "node:crypto";

export const WEBHOOK_EVENTS = [
  "employee.created",
  "employee.updated",
  "employee.terminated",
  "leave.requested",
  "leave.approved",
  "leave.rejected",
  "time.clocked",
  "document.uploaded",
  "test.ping",
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

/**
 * Generates a secure random secret for HMAC-SHA256 webhook signatures.
 */
export function generateWebhookSecret(): string {
  return `whsec_${crypto.randomBytes(24).toString("hex")}`;
}

/**
 * Computes HMAC-SHA256 signature for webhook payload.
 */
export function signWebhookPayload(
  payload: string,
  secret: string,
  timestamp: number = Math.floor(Date.now() / 1000),
): { signature: string; header: string; timestamp: number } {
  const data = `${timestamp}.${payload}`;
  const signature = crypto
    .createHmac("sha256", secret)
    .update(data, "utf-8")
    .digest("hex");

  return {
    signature,
    header: `t=${timestamp},v1=${signature}`,
    timestamp,
  };
}

/**
 * Verifies the incoming webhook signature with timing-safe comparison and replay protection.
 */
export function verifyWebhookSignature(
  payload: string,
  header: string,
  secret: string,
  toleranceSeconds = 300,
): boolean {
  if (!header || !secret || !payload) return false;

  const parts = header.split(",");
  let timestamp: number | null = null;
  let receivedSignature: string | null = null;

  for (const part of parts) {
    const [key, value] = part.split("=");
    if (key?.trim() === "t" && value) {
      timestamp = parseInt(value.trim(), 10);
    } else if (key?.trim() === "v1" && value) {
      receivedSignature = value.trim();
    }
  }

  if (timestamp === null || isNaN(timestamp) || !receivedSignature) {
    return false;
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > toleranceSeconds) {
    return false; // Expired timestamp / replay attack prevention
  }

  const { signature: expectedSignature } = signWebhookPayload(
    payload,
    secret,
    timestamp,
  );

  try {
    return crypto.timingSafeEqual(
      Buffer.from(receivedSignature, "hex"),
      Buffer.from(expectedSignature, "hex"),
    );
  } catch {
    return false;
  }
}
