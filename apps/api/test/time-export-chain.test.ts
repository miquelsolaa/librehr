import { describe, expect, it } from "vitest";
import type { TimeChainLink, TimeEventRow } from "@librehr/db";
import { correctedDates } from "../src/lib/time-export.js";
import { employeeChainStatus } from "../src/lib/time-export-chain.js";
import {
  createTimeChainSigner,
  resolveTimeChainKey,
} from "../src/lib/time-chain.js";

// TIM-002 status shown in the TIM-006 export, on rows built in memory and
// signed with the public development key.
const key = resolveTimeChainKey(undefined);
const sign = createTimeChainSigner(key);
const ORG = "0a000000-0000-4000-8000-000000000001";
const EMPLOYEE = "0e000000-0000-4000-8000-000000000001";
const ACTOR = "0c000000-0000-4000-8000-000000000001";

const id = (n: number) =>
  `0f000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function row(link: TimeChainLink, hash: string, hashVersion = 2): TimeEventRow {
  return {
    ...link,
    occurredAt: new Date(link.occurredAt),
    recordedAt: new Date(link.recordedAt),
    hash,
    hashVersion,
    createdAt: new Date(link.recordedAt),
  };
}

/** A valid chain of `n` punches, one hour apart from 08:00 UTC. */
function chain(n: number): TimeEventRow[] {
  const rows: TimeEventRow[] = [];
  let prevHash: string | null = null;
  for (let seq = 1; seq <= n; seq++) {
    const at = new Date(Date.UTC(2026, 10, 2, 7 + seq)).toISOString();
    const link: TimeChainLink = {
      id: id(seq),
      organizationId: ORG,
      employeeId: EMPLOYEE,
      seq,
      eventType: seq % 2 === 1 ? "clock_in" : "clock_out",
      occurredAt: at,
      recordedAt: at,
      source: "web",
      actorId: ACTOR,
      refEventId: null,
      reason: null,
      prevHash,
    };
    const hash = sign(link);
    rows.push(row(link, hash));
    prevHash = hash;
  }
  return rows;
}

const headOf = (rows: TimeEventRow[]) => {
  const last = rows[rows.length - 1]!;
  return { seq: last.seq!, hash: last.hash };
};

const status = (
  rows: TimeEventRow[],
  anchor: { seq: number; hash: string } | null,
) => employeeChainStatus(key, EMPLOYEE, rows, anchor);

describe("employeeChainStatus (TIM-002 in TIM-006)", () => {
  it("verifies an intact chain whose anchor names its newest link", () => {
    const rows = chain(4);
    expect(status(rows, headOf(rows))).toBe("verified");
    // Order of the input does not matter: rows are checked in seq order.
    expect(status([...rows].reverse(), headOf(rows))).toBe("verified");
  });

  it("flags an altered row", () => {
    const rows = chain(4);
    rows[1] = { ...rows[1]!, occurredAt: new Date("2026-11-02T07:00:00Z") };
    expect(status(rows, headOf(rows))).toBe("tampered");
  });

  it("flags an altered stored hash", () => {
    const rows = chain(4);
    const anchor = headOf(rows);
    rows[2] = { ...rows[2]!, hash: "0".repeat(64) };
    expect(status(rows, anchor)).toBe("tampered");
  });

  it("flags a deleted middle row", () => {
    const rows = chain(4);
    const anchor = headOf(rows);
    rows.splice(1, 1);
    expect(status(rows, anchor)).toBe("tampered");
  });

  it("flags a deleted last row while the anchor still points at it", () => {
    const rows = chain(4);
    const anchor = headOf(rows);
    // The remaining rows link perfectly: only the anchor shows the loss.
    expect(status(rows.slice(0, 3), anchor)).toBe("tampered");
  });

  it("flags chained rows without an anchor", () => {
    expect(status(chain(2), null)).toBe("tampered");
  });

  it("flags a v2 row stripped of its chain position", () => {
    const rows = chain(3);
    const anchor = headOf(rows);
    const stripped = { ...rows[2]!, seq: null };
    expect(status([rows[0]!, rows[1]!, stripped], anchor)).toBe("tampered");
  });

  it("reports legacy rows only as legacy, never verified or tampered", () => {
    const legacy = chain(2).map((r) => ({ ...r, seq: null, hashVersion: 1 }));
    expect(status(legacy, null)).toBe("legacy_only");
    // Legacy rows next to a valid chain do not hide or spoil it.
    const rows = chain(2);
    expect(
      status(
        [...legacy.map((r, i) => ({ ...r, id: id(90 + i) })), ...rows],
        headOf(rows),
      ),
    ).toBe("verified");
  });

  it("reports an employee without records as empty", () => {
    expect(status([], null)).toBe("empty");
  });

  it("flags an anchor whose rows are all gone", () => {
    const rows = chain(2);
    expect(status([], headOf(rows))).toBe("tampered");
  });
});

describe("correctedDates (TIM-003 in TIM-006)", () => {
  const rows = chain(2);
  const original = rows[1]!; // clock_out at 09:00 UTC on 2 November
  // Corrected to 23:30 UTC: 3 November in Madrid, still 2 November in Canary.
  const correctionLink: TimeChainLink = {
    id: id(3),
    organizationId: ORG,
    employeeId: EMPLOYEE,
    seq: 3,
    eventType: "clock_out",
    occurredAt: "2026-11-02T23:30:00.000Z",
    recordedAt: "2026-11-04T09:00:00.000Z",
    source: "manual",
    actorId: ACTOR,
    refEventId: original.id,
    reason: "Forgot to clock out",
    prevHash: original.hash,
  };
  const events = [...rows, row(correctionLink, sign(correctionLink))];

  it("dates both the correction and the record it replaces in the given zone", () => {
    expect(
      correctedDates(events, "Europe/Madrid", "2026-11-01", "2026-11-05"),
    ).toEqual(["2026-11-02", "2026-11-03"]);
    expect(
      correctedDates(events, "Atlantic/Canary", "2026-11-01", "2026-11-05"),
    ).toEqual(["2026-11-02"]);
  });

  it("keeps only dates inside the period, which differ across zones", () => {
    expect(
      correctedDates(events, "Europe/Madrid", "2026-11-03", "2026-11-03"),
    ).toEqual(["2026-11-03"]);
    expect(
      correctedDates(events, "Atlantic/Canary", "2026-11-03", "2026-11-03"),
    ).toEqual([]);
  });

  it("ignores events that correct nothing", () => {
    expect(
      correctedDates(rows, "Europe/Madrid", "2026-11-01", "2026-11-05"),
    ).toEqual([]);
  });
});
