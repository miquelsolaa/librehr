import crypto from "node:crypto";
import type { TimeEvent } from "./events.js";

export interface CanonicalTimeEventData {
  organizationId: string;
  employeeId: string;
  eventType: string;
  occurredAt: string;
  recordedAt: string;
  source: string;
  actorId: string;
  refEventId?: string | undefined;
  reason?: string | undefined;
}

/**
 * Serializes an object with deterministic, alphabetically sorted keys.
 */
export function canonicalJson(obj: unknown): string {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }

  if (Array.isArray(obj)) {
    return `[${obj.map(canonicalJson).join(",")}]`;
  }

  const record = obj as Record<string, unknown>;
  const sortedKeys = Object.keys(record).sort();
  const pairs = sortedKeys
    .filter((k) => record[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`);

  return `{${pairs.join(",")}}`;
}

/**
 * Calculates SHA-256 hash linking an event to its predecessor in the employee's audit chain:
 * sha256(prev_hash || canonical_json(event))
 */
export function computeEventHash(
  prevHash: string | null,
  eventData: CanonicalTimeEventData,
): string {
  const canonical = canonicalJson(eventData);
  const input = `${prevHash ?? "GENESIS"}||${canonical}`;
  return crypto.createHash("sha256").update(input, "utf-8").digest("hex");
}

export interface VerificationResult {
  valid: boolean;
  tamperedIndex?: number;
  reason?: string;
}

/**
 * Verifies the integrity of an append-only hash chain of time events.
 * Detects any data tampering or out-of-order mutations.
 */
export function verifyEventChain(
  events: readonly TimeEvent[],
): VerificationResult {
  let expectedPrevHash: string | null = null;

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (!event) continue;

    // 1. Verify prevHash link
    if (event.prevHash !== expectedPrevHash) {
      return {
        valid: false,
        tamperedIndex: i,
        reason: `Broken chain link at index ${i}: expected prevHash ${expectedPrevHash}, found ${event.prevHash}`,
      };
    }

    // 2. Recompute and verify event hash
    const canonicalData: CanonicalTimeEventData = {
      organizationId: event.organizationId,
      employeeId: event.employeeId,
      eventType: event.eventType,
      occurredAt: event.occurredAt,
      recordedAt: event.recordedAt,
      source: event.source,
      actorId: event.actorId,
      refEventId: event.refEventId,
      reason: event.reason,
    };

    const recomputedHash = computeEventHash(event.prevHash, canonicalData);
    if (recomputedHash !== event.hash) {
      return {
        valid: false,
        tamperedIndex: i,
        reason: `Hash mismatch at index ${i}: recomputed ${recomputedHash}, stored ${event.hash}`,
      };
    }

    expectedPrevHash = event.hash;
  }

  return { valid: true };
}
