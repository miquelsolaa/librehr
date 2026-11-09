import crypto from "node:crypto";

/**
 * Tamper evidence for time records (TIM-002).
 *
 * Version 1 rows (written before the time-chain v2 migration) used an unkeyed SHA-256 over
 * a payload whose `recordedAt` never matched the stored column, so they cannot
 * be verified. They are reported as `legacy`: never as verified, never as
 * tampered.
 *
 * Version 2 rows carry a per-employee `seq` and an HMAC-SHA256, keyed by
 * `TIME_CHAIN_KEY`, over {@link canonicalTimeEventPayloadV2}.
 */
export const TIME_CHAIN_VERSION = 2;

/** Every stored field of a v2 time event that the chain protects. */
export interface ChainedTimeEventFields {
  id: string;
  organizationId: string;
  employeeId: string;
  seq: number;
  eventType: string;
  /** ISO 8601 UTC with milliseconds, as produced by `Date#toISOString`. */
  occurredAt: string;
  /** ISO 8601 UTC with milliseconds, as produced by `Date#toISOString`. */
  recordedAt: string;
  source: string;
  actorId: string;
  refEventId: string | null;
  reason: string | null;
  prevHash: string | null;
}

/** A stored time event as read back for verification. */
export interface StoredChainEvent extends Omit<ChainedTimeEventFields, "seq"> {
  hashVersion: number;
  /** Null for legacy (v1) rows. */
  seq: number | null;
  hash: string;
}

/**
 * Field order of the v2 payload. Changing it, or the encoding, requires a new
 * version: rows already written must keep verifying.
 */
const V2_FIELDS = [
  "id",
  "organizationId",
  "employeeId",
  "seq",
  "eventType",
  "occurredAt",
  "recordedAt",
  "source",
  "actorId",
  "refEventId",
  "reason",
  "prevHash",
] as const satisfies readonly (keyof ChainedTimeEventFields)[];

/**
 * Serializes a v2 event deterministically: a version header, then one
 * `name=value` line per field in a fixed order. Values are JSON-encoded, so
 * strings are quoted and escaped, numbers are bare and a missing optional
 * field is an explicit `null`; no two different events share an encoding.
 *
 * @example
 * canonicalTimeEventPayloadV2({ id: "e1", seq: 1, reason: null, ... });
 * // "librehr.time_event.v2\nid=\"e1\"\norganizationId=...\nseq=1\n...reason=null\n..."
 */
export function canonicalTimeEventPayloadV2(
  fields: ChainedTimeEventFields,
): string {
  const lines = V2_FIELDS.map(
    (name) => `${name}=${JSON.stringify(fields[name])}`,
  );
  return [`librehr.time_event.v${TIME_CHAIN_VERSION}`, ...lines].join("\n");
}

/**
 * Computes the v2 chain hash: hex HMAC-SHA256 of the canonical payload.
 * The key is passed in by the caller (from the validated environment); core
 * never reads configuration itself.
 *
 * @example
 * const hash = computeEventHashV2(env.TIME_CHAIN_KEY, {
 *   id, organizationId, employeeId, seq: 1, eventType: "clock_in",
 *   occurredAt: "2026-11-02T08:00:00.000Z", recordedAt: "2026-11-02T08:00:00.120Z",
 *   source: "web", actorId, refEventId: null, reason: null, prevHash: null,
 * });
 */
export function computeEventHashV2(
  key: string,
  fields: ChainedTimeEventFields,
): string {
  if (!key) throw new Error("A time chain key is required");
  return crypto
    .createHmac("sha256", key)
    .update(canonicalTimeEventPayloadV2(fields), "utf-8")
    .digest("hex");
}

export type ChainIssueKind =
  | "hash_mismatch"
  | "seq_gap"
  | "broken_link"
  | "employee_mismatch"
  | "unknown_version";

/** Version of rows written before the keyed chain; unverifiable by design. */
export const LEGACY_CHAIN_VERSION = 1;

export interface ChainIssue {
  /** Event id only: never names or other personal data. */
  eventId: string;
  seq: number | null;
  kind: ChainIssueKind;
}

/** Where the next v2 event of a chain must continue from. */
export interface ChainCursor {
  expectedSeq: number;
  expectedPrevHash: string | null;
}

export interface ChainVerificationCounts {
  verified: number;
  tampered: number;
  legacy: number;
}

export interface ChainSegmentResult extends ChainVerificationCounts {
  cursor: ChainCursor;
  issues: ChainIssue[];
}

export type ChainStatus = "verified" | "tampered" | "legacy_only" | "empty";

export const INITIAL_CHAIN_CURSOR: ChainCursor = {
  expectedSeq: 1,
  expectedPrevHash: null,
};

function timingSafeHexEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf-8");
  const right = Buffer.from(b, "utf-8");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

/**
 * Verifies one segment of a single employee's chain, so long chains can be
 * checked in batches: pass the returned cursor into the next call.
 *
 * `events` are the employee's chained rows in ascending `seq` order; legacy
 * rows (v1, no seq) may be mixed in and are only counted as legacy. A v2 row is verified only when its
 * seq follows the previous one, its prevHash equals the previous stored hash
 * and its recomputed HMAC matches; otherwise it is tampered. The cursor
 * advances past a tampered row, so one forgery does not mark every later row.
 *
 * @example
 * let cursor = INITIAL_CHAIN_CURSOR;
 * for (const batch of batches) {
 *   const r = verifyChainSegment(key, employeeId, batch, cursor);
 *   cursor = r.cursor;
 * }
 */
export function verifyChainSegment(
  key: string,
  employeeId: string,
  events: readonly StoredChainEvent[],
  cursor: ChainCursor = INITIAL_CHAIN_CURSOR,
): ChainSegmentResult {
  let { expectedSeq, expectedPrevHash } = cursor;
  let verified = 0;
  let tampered = 0;
  let legacy = 0;
  const issues: ChainIssue[] = [];

  for (const event of events) {
    // Legacy rows never had a chain position. A "v1" row that has one was
    // downgraded to hide it from verification, so it counts as tampered.
    if (event.hashVersion === LEGACY_CHAIN_VERSION && event.seq === null) {
      legacy++;
      continue;
    }

    const rowIssues: ChainIssueKind[] = [];
    if (event.hashVersion !== TIME_CHAIN_VERSION) {
      rowIssues.push("unknown_version");
    }
    if (event.employeeId !== employeeId) rowIssues.push("employee_mismatch");
    if (event.seq !== expectedSeq) rowIssues.push("seq_gap");
    if (event.prevHash !== expectedPrevHash) rowIssues.push("broken_link");

    if (event.seq === null) {
      rowIssues.push("hash_mismatch");
    } else {
      const recomputed = computeEventHashV2(key, {
        id: event.id,
        organizationId: event.organizationId,
        employeeId: event.employeeId,
        seq: event.seq,
        eventType: event.eventType,
        occurredAt: event.occurredAt,
        recordedAt: event.recordedAt,
        source: event.source,
        actorId: event.actorId,
        refEventId: event.refEventId,
        reason: event.reason,
        prevHash: event.prevHash,
      });
      if (!timingSafeHexEqual(recomputed, event.hash)) {
        rowIssues.push("hash_mismatch");
      }
    }

    if (rowIssues.length === 0) {
      verified++;
    } else {
      tampered++;
      for (const kind of rowIssues) {
        issues.push({ eventId: event.id, seq: event.seq, kind });
      }
    }

    expectedSeq = (event.seq ?? expectedSeq) + 1;
    expectedPrevHash = event.hash;
  }

  return {
    verified,
    tampered,
    legacy,
    issues,
    cursor: { expectedSeq, expectedPrevHash },
  };
}

/**
 * Overall status from counts. Any tampered row wins: a chain with tampered
 * rows is never reported as verified.
 *
 * @example
 * chainStatus({ verified: 3, tampered: 0, legacy: 2 }); // "verified"
 * chainStatus({ verified: 0, tampered: 0, legacy: 2 }); // "legacy_only"
 */
export function chainStatus(counts: ChainVerificationCounts): ChainStatus {
  if (counts.tampered > 0) return "tampered";
  if (counts.verified > 0) return "verified";
  if (counts.legacy > 0) return "legacy_only";
  return "empty";
}

/**
 * Verifies a whole chain held in memory. Convenience over
 * {@link verifyChainSegment} for tests and small chains.
 *
 * @example
 * verifyEventChainV2(key, employeeId, rows).status; // "verified"
 */
export function verifyEventChainV2(
  key: string,
  employeeId: string,
  events: readonly StoredChainEvent[],
): ChainSegmentResult & { status: ChainStatus } {
  const result = verifyChainSegment(key, employeeId, events);
  return { ...result, status: chainStatus(result) };
}
