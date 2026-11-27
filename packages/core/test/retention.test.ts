import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { Temporal } from "temporal-polyfill";
import {
  RETENTION_CATEGORIES,
  RETENTION_CATEGORY_DEFINITIONS,
  RETENTION_MAX_DAYS,
  assertRetentionDays,
  isRetentionCategory,
  planRetention,
  retentionCutoff,
} from "../src/retention/index.js";

const MADRID = "Europe/Madrid";

describe("retentionCutoff", () => {
  it("keeps exactly retentionDays local days, run day included", () => {
    expect(retentionCutoff("2026-11-26", 1, MADRID).cutoffDate).toBe(
      "2026-11-26",
    );
    expect(retentionCutoff("2026-11-26", 30, MADRID)).toEqual({
      cutoffDate: "2026-10-28",
      cutoffInstant: new Date("2026-10-27T23:00:00Z"),
    });
  });

  it("crosses a year boundary", () => {
    expect(retentionCutoff("2027-01-01", 30, MADRID).cutoffDate).toBe(
      "2026-12-03",
    );
  });

  it("counts leap days as days", () => {
    // 2024-03-01 .. 2028-02-29 is 1461 days, 2024-02-29 included in neither.
    expect(retentionCutoff("2028-02-29", 1461, MADRID).cutoffDate).toBe(
      "2024-03-01",
    );
    expect(retentionCutoff("2029-02-28", 365, MADRID).cutoffDate).toBe(
      "2028-03-01",
    );
  });

  it("starts the cutoff day at local midnight across DST changes", () => {
    // Madrid moves to UTC+2 on 29 March 2026 at 02:00; midnight is UTC+1.
    expect(retentionCutoff("2026-03-29", 1, MADRID).cutoffInstant).toEqual(
      new Date("2026-03-28T23:00:00Z"),
    );
    expect(retentionCutoff("2026-03-30", 1, MADRID).cutoffInstant).toEqual(
      new Date("2026-03-29T22:00:00Z"),
    );
    // Back to UTC+1 on 25 October 2026 at 03:00; midnight is still UTC+2.
    expect(retentionCutoff("2026-10-25", 1, MADRID).cutoffInstant).toEqual(
      new Date("2026-10-24T22:00:00Z"),
    );
    expect(retentionCutoff("2026-10-26", 1, MADRID).cutoffInstant).toEqual(
      new Date("2026-10-25T23:00:00Z"),
    );
  });

  it("uses the given zone", () => {
    expect(
      retentionCutoff("2026-11-26", 1, "Atlantic/Canary").cutoffInstant,
    ).toEqual(new Date("2026-11-26T00:00:00Z"));
  });

  it("rejects invalid input", () => {
    expect(() => retentionCutoff("2027-02-29", 1, MADRID)).toThrow(RangeError);
    expect(() => retentionCutoff("2026-11-26", 0, MADRID)).toThrow(RangeError);
    expect(() => retentionCutoff("2026-11-26", 1.5, MADRID)).toThrow(
      RangeError,
    );
    expect(() => retentionCutoff("2026-11-26", 1, "Mars/Olympus")).toThrow(
      RangeError,
    );
  });

  it("makes day D eligible exactly when D + days <= runDate", () => {
    const day = fc
      .integer({ min: 0, max: 3650 })
      .map((n) =>
        Temporal.PlainDate.from("2024-01-01").add({ days: n }).toString(),
      );
    fc.assert(
      fc.property(
        day,
        day,
        fc.integer({ min: 1, max: 2000 }),
        (runDate, recordDate, days) => {
          const { cutoffDate } = retentionCutoff(runDate, days, MADRID);
          const eligible =
            Temporal.PlainDate.compare(recordDate, cutoffDate) < 0;
          const expired =
            Temporal.PlainDate.compare(
              Temporal.PlainDate.from(recordDate).add({ days }),
              runDate,
            ) <= 0;
          expect(eligible).toBe(expired);
        },
      ),
    );
  });
});

describe("planRetention", () => {
  it("covers every category with its default and report_only action", () => {
    const plan = planRetention({ runDate: "2026-11-26", timeZone: MADRID });
    expect(plan.map((e) => e.category)).toEqual([...RETENTION_CATEGORIES]);
    for (const entry of plan) {
      const definition = RETENTION_CATEGORY_DEFINITIONS[entry.category];
      expect(entry.source).toBe("default");
      expect(entry.retentionDays).toBe(definition.defaultDays);
      expect(entry.action).toBe("report_only");
    }
  });

  it("applies a configured period", () => {
    const plan = planRetention({
      runDate: "2026-11-26",
      timeZone: MADRID,
      configured: [{ category: "notifications", retentionDays: 180 }],
    });
    expect(plan.find((e) => e.category === "notifications")).toMatchObject({
      retentionDays: 180,
      source: "configured",
      cutoffDate: "2026-05-31",
    });
  });

  it("rejects an unknown category", () => {
    expect(() =>
      planRetention({
        runDate: "2026-11-26",
        timeZone: MADRID,
        configured: [{ category: "payroll", retentionDays: 30 }],
      }),
    ).toThrow(RangeError);
  });

  it("never applies a period below a legal floor", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...RETENTION_CATEGORIES),
        fc.integer({ min: 1, max: RETENTION_MAX_DAYS }),
        (category, retentionDays) => {
          const entry = planRetention({
            runDate: "2026-11-26",
            timeZone: MADRID,
            configured: [{ category, retentionDays }],
          }).find((e) => e.category === category);
          const floor =
            RETENTION_CATEGORY_DEFINITIONS[category].legalMinimumDays;
          expect(entry?.retentionDays).toBe(
            Math.max(retentionDays, floor ?? 1),
          );
        },
      ),
    );
  });
});

describe("assertRetentionDays", () => {
  it("accepts periods from the floor to the maximum", () => {
    expect(() => assertRetentionDays("time_records", 1461)).not.toThrow();
    expect(() => assertRetentionDays("notifications", 1)).not.toThrow();
    expect(() =>
      assertRetentionDays("notifications", RETENTION_MAX_DAYS),
    ).not.toThrow();
  });

  it("rejects periods below the floor, out of range or fractional", () => {
    expect(() => assertRetentionDays("time_records", 1460)).toThrow(RangeError);
    expect(() => assertRetentionDays("notifications", 0)).toThrow(RangeError);
    expect(() =>
      assertRetentionDays("notifications", RETENTION_MAX_DAYS + 1),
    ).toThrow(RangeError);
    expect(() => assertRetentionDays("notifications", 2.5)).toThrow(RangeError);
  });

  it("recognizes categories", () => {
    expect(isRetentionCategory("deleted_documents")).toBe(true);
    expect(isRetentionCategory("payroll")).toBe(false);
  });
});
