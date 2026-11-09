import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  canonicalTimeEventPayloadV2,
  chainStatus,
  computeEventHashV2,
  verifyChainSegment,
  verifyEventChainV2,
  type StoredChainEvent,
} from "../src/time/hash-chain.js";

const KEY = "test_time_chain_key_with_at_least_32_chars";
const ORG = "00000000-0000-4000-8000-000000000001";
const EMP = "00000000-0000-4000-8000-000000000002";

const optionalText = fc.option(fc.string({ maxLength: 40 }), { nil: null });
const eventInput = fc.record({
  id: fc.uuid(),
  eventType: fc.constantFrom(
    "clock_in",
    "clock_out",
    "break_start",
    "break_end",
    "correction",
  ),
  occurredMs: fc.integer({ min: 1_600_000_000_000, max: 1_900_000_000_000 }),
  recordedOffsetMs: fc.integer({ min: 0, max: 5_000 }),
  source: fc.constantFrom("web", "mobile", "kiosk", "manual"),
  actorId: fc.uuid(),
  refEventId: fc.option(fc.uuid(), { nil: null }),
  reason: optionalText,
});
type EventInput = typeof eventInput extends fc.Arbitrary<infer T> ? T : never;

function buildChain(inputs: EventInput[]): StoredChainEvent[] {
  const chain: StoredChainEvent[] = [];
  let prevHash: string | null = null;
  inputs.forEach((input, index) => {
    const fields = {
      id: input.id,
      organizationId: ORG,
      employeeId: EMP,
      seq: index + 1,
      eventType: input.eventType,
      occurredAt: new Date(input.occurredMs).toISOString(),
      recordedAt: new Date(
        input.occurredMs + input.recordedOffsetMs,
      ).toISOString(),
      source: input.source,
      actorId: input.actorId,
      refEventId: input.refEventId,
      reason: input.reason,
      prevHash,
    };
    const hash = computeEventHashV2(KEY, fields);
    chain.push({ ...fields, hashVersion: 2, hash });
    prevHash = hash;
  });
  return chain;
}

const chainArb = fc
  .array(eventInput, { minLength: 1, maxLength: 12 })
  .map(buildChain);

/** Changes one stored field to a different value of the same shape. */
function mutate(
  event: StoredChainEvent,
  field: keyof StoredChainEvent,
): StoredChainEvent {
  const copy = { ...event };
  switch (field) {
    case "seq":
      copy.seq = (event.seq ?? 0) + 1;
      break;
    case "hashVersion":
      // Downgrading a chained row to v1 must not hide it as legacy.
      copy.hashVersion = 1;
      break;
    case "occurredAt":
    case "recordedAt":
      copy[field] = new Date(Date.parse(event[field]) + 1).toISOString();
      break;
    case "refEventId":
    case "reason":
    case "prevHash":
      copy[field] = event[field] === null ? "x" : `${event[field]}x`;
      break;
    default:
      copy[field] = `${event[field]}x`;
  }
  return copy;
}

const MUTABLE_FIELDS: (keyof StoredChainEvent)[] = [
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
  "hash",
  "hashVersion",
];

describe("time hash chain v2 (TIM-002)", () => {
  it("encodes every field explicitly, in a fixed order, with a version header", () => {
    const payload = canonicalTimeEventPayloadV2({
      id: "e1",
      organizationId: "o1",
      employeeId: "p1",
      seq: 3,
      eventType: "clock_in",
      occurredAt: "2026-11-02T08:00:00.000Z",
      recordedAt: "2026-11-02T08:00:00.250Z",
      source: "web",
      actorId: "u1",
      refEventId: null,
      reason: 'a\n"b"',
      prevHash: null,
    });
    expect(payload).toBe(
      [
        "librehr.time_event.v2",
        'id="e1"',
        'organizationId="o1"',
        'employeeId="p1"',
        "seq=3",
        'eventType="clock_in"',
        'occurredAt="2026-11-02T08:00:00.000Z"',
        'recordedAt="2026-11-02T08:00:00.250Z"',
        'source="web"',
        'actorId="u1"',
        "refEventId=null",
        'reason="a\\n\\"b\\""',
        "prevHash=null",
      ].join("\n"),
    );
  });

  it("is keyed: another key yields another hash", () => {
    const [event] = buildChain([
      {
        id: "e1",
        eventType: "clock_in",
        occurredMs: 1_700_000_000_000,
        recordedOffsetMs: 0,
        source: "web",
        actorId: "u1",
        refEventId: null,
        reason: null,
      },
    ]);
    const { hash: _hash, hashVersion: _v, ...fields } = event!;
    expect(
      computeEventHashV2("another_key_also_32_characters_long!", {
        ...fields,
        seq: 1,
      }),
    ).not.toBe(event!.hash);
    expect(() => computeEventHashV2("", { ...fields, seq: 1 })).toThrow();
  });

  it("property: a correctly built chain verifies", () => {
    fc.assert(
      fc.property(chainArb, (chain) => {
        const result = verifyEventChainV2(KEY, EMP, chain);
        expect(result.status).toBe("verified");
        expect(result.verified).toBe(chain.length);
        expect(result.tampered).toBe(0);
        expect(result.issues).toEqual([]);
      }),
    );
  });

  it("property: any single-field mutation of any event is detected", () => {
    fc.assert(
      fc.property(
        chainArb,
        fc.nat(),
        fc.constantFrom(...MUTABLE_FIELDS),
        (chain, rawIndex, field) => {
          const index = rawIndex % chain.length;
          const tampered = chain.map((e, i) =>
            i === index ? mutate(e, field) : e,
          );
          const result = verifyEventChainV2(KEY, EMP, tampered);
          expect(result.status).toBe("tampered");
          expect(result.tampered).toBeGreaterThan(0);
          expect(
            result.issues.some((i) => i.eventId === tampered[index]!.id),
          ).toBe(true);
        },
      ),
    );
  });

  it("property: reordering events is detected", () => {
    fc.assert(
      fc.property(
        chainArb.filter((c) => c.length >= 2),
        fc.nat(),
        fc.nat(),
        (chain, a, b) => {
          const i = a % chain.length;
          let j = b % chain.length;
          if (i === j) j = (j + 1) % chain.length;
          const reordered = [...chain];
          [reordered[i], reordered[j]] = [reordered[j]!, reordered[i]!];
          expect(verifyEventChainV2(KEY, EMP, reordered).status).toBe(
            "tampered",
          );
        },
      ),
    );
  });

  it("property: removing an event from the middle is detected as a gap", () => {
    fc.assert(
      fc.property(
        chainArb.filter((c) => c.length >= 3),
        fc.nat(),
        (chain, raw) => {
          const index = 1 + (raw % (chain.length - 2));
          const gapped = chain.filter((_, i) => i !== index);
          const result = verifyEventChainV2(KEY, EMP, gapped);
          expect(result.status).toBe("tampered");
          expect(result.issues.map((i) => i.kind)).toContain("seq_gap");
        },
      ),
    );
  });

  it("property: verifying in batches gives the same counts as all at once", () => {
    fc.assert(
      fc.property(chainArb, fc.integer({ min: 1, max: 5 }), (chain, size) => {
        let cursor = undefined as Parameters<typeof verifyChainSegment>[3];
        let verified = 0;
        for (let start = 0; start < chain.length; start += size) {
          const r = verifyChainSegment(
            KEY,
            EMP,
            chain.slice(start, start + size),
            cursor,
          );
          cursor = r.cursor;
          verified += r.verified;
          expect(r.tampered).toBe(0);
        }
        expect(verified).toBe(chain.length);
      }),
    );
  });

  it("reports v1 rows as legacy, never as verified or tampered", () => {
    const legacy: StoredChainEvent = {
      id: "legacy-1",
      organizationId: ORG,
      employeeId: EMP,
      seq: null,
      eventType: "clock_in",
      occurredAt: "2025-01-01T08:00:00.000Z",
      recordedAt: "2025-01-01T08:00:00.000Z",
      source: "web",
      actorId: "u1",
      refEventId: null,
      reason: null,
      prevHash: null,
      hash: "not-a-verifiable-hash",
      hashVersion: 1,
    };
    const onlyLegacy = verifyEventChainV2(KEY, EMP, [legacy, legacy]);
    expect(onlyLegacy).toMatchObject({
      verified: 0,
      tampered: 0,
      legacy: 2,
      status: "legacy_only",
    });

    const chain = buildChain([
      {
        id: "e1",
        eventType: "clock_in",
        occurredMs: 1_800_000_000_000,
        recordedOffsetMs: 0,
        source: "web",
        actorId: "u1",
        refEventId: null,
        reason: null,
      },
    ]);
    const mixed = verifyEventChainV2(KEY, EMP, [legacy, ...chain]);
    expect(mixed).toMatchObject({
      verified: 1,
      tampered: 0,
      legacy: 1,
      status: "verified",
    });
  });

  it("never reports verified when any row is tampered", () => {
    expect(chainStatus({ verified: 10, tampered: 1, legacy: 0 })).toBe(
      "tampered",
    );
    expect(chainStatus({ verified: 0, tampered: 0, legacy: 0 })).toBe("empty");
  });
});
