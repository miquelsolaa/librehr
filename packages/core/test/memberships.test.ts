import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  activeMembershipsOn,
  allocationOn,
  findOverlappingMembership,
  isMembershipActiveDuring,
  isMembershipActiveOn,
  isSameMembershipTarget,
  membershipPeriodsOverlap,
  peakAllocationDuring,
  planPrimaryDepartmentChange,
  type EmployeeMembership,
  type MembershipPeriod,
} from "../src/org/memberships.js";
import { addDays, datesInRange } from "../src/calendar/business-date.js";

const dept = (
  departmentId: string,
  startDate: string,
  endDate: string | null,
  allocationPercent: number | null = null,
): EmployeeMembership => ({
  departmentId,
  groupId: null,
  startDate,
  endDate,
  allocationPercent,
});

const group = (
  groupId: string,
  startDate: string,
  endDate: string | null,
  allocationPercent: number | null = null,
): EmployeeMembership => ({
  departmentId: null,
  groupId,
  startDate,
  endDate,
  allocationPercent,
});

// Calendar dates between 2024-01-01 and about 2031, so ranges cross year
// boundaries and leap days (2024-02-29, 2028-02-29).
const dateArb = fc
  .integer({ min: 0, max: 2800 })
  .map((offset) => addDays("2024-01-01", offset));

const periodArb: fc.Arbitrary<MembershipPeriod> = fc
  .tuple(dateArb, fc.option(fc.integer({ min: 0, max: 400 }), { nil: null }))
  .map(([startDate, length]) => ({
    startDate,
    endDate: length === null ? null : addDays(startDate, length),
  }));

describe("memberships (ORG-007)", () => {
  describe("isMembershipActiveOn", () => {
    it("includes both ends of the period", () => {
      const m = dept("d1", "2026-01-01", "2026-12-31");
      expect(isMembershipActiveOn(m, "2025-12-31")).toBe(false);
      expect(isMembershipActiveOn(m, "2026-01-01")).toBe(true);
      expect(isMembershipActiveOn(m, "2026-12-31")).toBe(true);
      expect(isMembershipActiveOn(m, "2027-01-01")).toBe(false);
    });

    it("treats a null end date as open-ended", () => {
      const m = group("g1", "2026-06-15", null);
      expect(isMembershipActiveOn(m, "2026-06-14")).toBe(false);
      expect(isMembershipActiveOn(m, "2099-12-31")).toBe(true);
    });

    it("handles a one-day membership on a leap day", () => {
      const m = dept("d1", "2028-02-29", "2028-02-29");
      expect(isMembershipActiveOn(m, "2028-02-28")).toBe(false);
      expect(isMembershipActiveOn(m, "2028-02-29")).toBe(true);
      expect(isMembershipActiveOn(m, "2028-03-01")).toBe(false);
    });
  });

  describe("isMembershipActiveDuring", () => {
    const m = dept("d1", "2026-03-01", "2026-03-31");

    it("matches a range touching either end", () => {
      expect(
        isMembershipActiveDuring(m, {
          startDate: "2026-02-25",
          endDate: "2026-03-01",
        }),
      ).toBe(true);
      expect(
        isMembershipActiveDuring(m, {
          startDate: "2026-03-31",
          endDate: "2026-04-03",
        }),
      ).toBe(true);
    });

    it("rejects ranges fully before or after", () => {
      expect(
        isMembershipActiveDuring(m, {
          startDate: "2026-02-01",
          endDate: "2026-02-28",
        }),
      ).toBe(false);
      expect(
        isMembershipActiveDuring(m, {
          startDate: "2026-04-01",
          endDate: "2026-04-30",
        }),
      ).toBe(false);
    });

    it("matches a range crossing the year boundary for an open-ended row", () => {
      expect(
        isMembershipActiveDuring(group("g1", "2026-12-31", null), {
          startDate: "2026-12-28",
          endDate: "2027-01-04",
        }),
      ).toBe(true);
    });
  });

  describe("membershipPeriodsOverlap", () => {
    it("does not overlap back-to-back periods", () => {
      expect(
        membershipPeriodsOverlap(
          { startDate: "2026-01-01", endDate: "2026-12-31" },
          { startDate: "2027-01-01", endDate: null },
        ),
      ).toBe(false);
    });

    it("overlaps on a single shared day", () => {
      expect(
        membershipPeriodsOverlap(
          { startDate: "2026-01-01", endDate: "2026-12-31" },
          { startDate: "2026-12-31", endDate: null },
        ),
      ).toBe(true);
    });

    it("overlaps two open-ended periods", () => {
      expect(
        membershipPeriodsOverlap(
          { startDate: "2026-01-01", endDate: null },
          { startDate: "2030-01-01", endDate: null },
        ),
      ).toBe(true);
    });

    it("is symmetric and agrees with a day-by-day check (property)", () => {
      fc.assert(
        fc.property(periodArb, periodArb, (a, b) => {
          const overlap = membershipPeriodsOverlap(a, b);
          expect(membershipPeriodsOverlap(b, a)).toBe(overlap);
          // Some day of a's (bounded) span is active in b exactly when they
          // overlap; an open end is cut after b's start or end.
          const horizon = b.endDate ?? addDays(b.startDate, 1);
          const last =
            a.endDate ??
            (horizon > a.startDate ? horizon : addDays(a.startDate, 1));
          const shared = datesInRange(a.startDate, last).some((d) =>
            isMembershipActiveOn(b, d),
          );
          expect(shared).toBe(overlap);
        }),
        { numRuns: 200 },
      );
    });
  });

  describe("findOverlappingMembership", () => {
    const existing = [
      dept("d1", "2026-01-01", "2026-06-30"),
      group("g1", "2026-01-01", null),
    ];

    it("finds an overlapping row of the same target", () => {
      expect(
        findOverlappingMembership(
          existing,
          dept("d1", "2026-06-30", "2026-07-31"),
        ),
      ).toBe(existing[0]);
    });

    it("ignores rows of other targets and of other kinds", () => {
      expect(
        findOverlappingMembership(existing, dept("d2", "2026-03-01", null)),
      ).toBeNull();
      // Same id string as a department, but a group: a different target.
      expect(
        findOverlappingMembership(existing, group("d1", "2026-03-01", null)),
      ).toBeNull();
    });

    it("accepts the next period of the same target", () => {
      expect(
        findOverlappingMembership(existing, dept("d1", "2026-07-01", null)),
      ).toBeNull();
    });

    it("never leaves two active rows of one target on a date (property)", () => {
      fc.assert(
        fc.property(
          fc.array(periodArb, { maxLength: 8 }),
          dateArb,
          (periods, day) => {
            // Insert rows in order and keep only those the check accepts,
            // as the API and the exclusion constraint do.
            const kept: EmployeeMembership[] = [];
            for (const p of periods) {
              const candidate = dept("d1", p.startDate, p.endDate);
              if (!findOverlappingMembership(kept, candidate))
                kept.push(candidate);
            }
            expect(activeMembershipsOn(kept, day).length).toBeLessThanOrEqual(
              1,
            );
          },
        ),
        { numRuns: 200 },
      );
    });
  });

  describe("isSameMembershipTarget", () => {
    it("compares departments with departments and groups with groups", () => {
      expect(
        isSameMembershipTarget(
          dept("x", "2026-01-01", null),
          dept("x", "2027-01-01", null),
        ),
      ).toBe(true);
      expect(
        isSameMembershipTarget(
          group("x", "2026-01-01", null),
          group("x", "2026-01-01", null),
        ),
      ).toBe(true);
      expect(
        isSameMembershipTarget(
          dept("x", "2026-01-01", null),
          group("x", "2026-01-01", null),
        ),
      ).toBe(false);
    });
  });

  describe("allocationOn", () => {
    it("sums the allocations active on the date and warns above 100%", () => {
      const rows = [
        dept("d1", "2026-01-01", null, 60),
        group("g1", "2026-01-01", "2026-12-31", 50),
        group("g2", "2027-01-01", null, 30),
      ];
      expect(allocationOn(rows, "2026-12-31")).toEqual({
        totalPercent: 110,
        overAllocated: true,
      });
      expect(allocationOn(rows, "2027-01-01")).toEqual({
        totalPercent: 90,
        overAllocated: false,
      });
    });

    it("does not warn at exactly 100% and ignores rows without allocation", () => {
      const rows = [
        dept("d1", "2026-01-01", null, 33.33),
        group("g1", "2026-01-01", null, 66.67),
        group("g2", "2026-01-01", null, null),
      ];
      expect(allocationOn(rows, "2026-05-01")).toEqual({
        totalPercent: 100,
        overAllocated: false,
      });
    });

    it("is zero with no active memberships", () => {
      expect(allocationOn([], "2026-05-01")).toEqual({
        totalPercent: 0,
        overAllocated: false,
      });
    });

    it("warns exactly when the active total exceeds 100 (property)", () => {
      const rowArb = fc
        .tuple(periodArb, fc.integer({ min: 1, max: 10000 }))
        .map(([p, hundredths]) =>
          group("g", p.startDate, p.endDate, hundredths / 100),
        );
      fc.assert(
        fc.property(
          fc.array(rowArb, { maxLength: 6 }),
          dateArb,
          (rows, day) => {
            const expected = activeMembershipsOn(rows, day).reduce(
              (sum, m) => sum + Math.round((m.allocationPercent ?? 0) * 100),
              0,
            );
            const result = allocationOn(rows, day);
            expect(result.totalPercent).toBe(expected / 100);
            expect(result.overAllocated).toBe(expected > 10000);
          },
        ),
        { numRuns: 200 },
      );
    });
  });
});

describe("peakAllocationDuring", () => {
  it("finds the day a later start pushes the total above 100%", () => {
    const rows = [
      dept("d1", "2026-01-01", null, 60),
      group("g1", "2026-03-01", "2026-03-31", 50),
    ];
    expect(
      peakAllocationDuring(rows, { startDate: "2026-01-01", endDate: null }),
    ).toEqual({ date: "2026-03-01", totalPercent: 110, overAllocated: true });
  });

  it("ignores starts outside the period and reports its first day otherwise", () => {
    const rows = [
      dept("d1", "2026-01-01", null, 40),
      group("g1", "2027-01-01", null, 80),
    ];
    expect(
      peakAllocationDuring(rows, {
        startDate: "2026-06-01",
        endDate: "2026-12-31",
      }),
    ).toEqual({ date: "2026-06-01", totalPercent: 40, overAllocated: false });
  });

  it("is at least the total of every day in the period", () => {
    const day = fc
      .integer({ min: 0, max: 400 })
      .map((n) => addDays("2026-01-01", n));
    const row = fc
      .tuple(
        day,
        fc.integer({ min: 0, max: 60 }),
        fc.integer({ min: 1, max: 100 }),
      )
      .map(([start, length, pct]) =>
        dept("d", start, addDays(start, length), pct),
      );
    fc.assert(
      fc.property(fc.array(row, { maxLength: 6 }), day, (rows, start) => {
        const end = addDays(start, 30);
        const peak = peakAllocationDuring(rows, {
          startDate: start,
          endDate: end,
        });
        for (const date of datesInRange(start, end)) {
          expect(peak.totalPercent).toBeGreaterThanOrEqual(
            allocationOn(rows, date).totalPercent,
          );
        }
      }),
    );
  });
});

describe("planPrimaryDepartmentChange (ADR 0008 decision 3)", () => {
  const row = (
    id: string,
    departmentId: string | null,
    startDate: string,
    endDate: string | null,
  ) => ({
    id,
    departmentId,
    groupId: departmentId ? null : "g1",
    startDate,
    endDate,
  });

  it("ends a current secondary in the new primary the day before", () => {
    const current = row("m1", "d2", "2026-01-01", null);
    const later = row("m2", "d2", "2025-06-01", "2027-01-01");
    expect(
      planPrimaryDepartmentChange([current, later], "d2", "2027-01-01"),
    ).toEqual({
      toEnd: [
        { membership: current, endDate: "2026-12-31" },
        { membership: later, endDate: "2026-12-31" },
      ],
      conflicts: [],
    });
  });

  it("leaves past rows, other departments and groups alone", () => {
    const plan = planPrimaryDepartmentChange(
      [
        row("past", "d2", "2025-01-01", "2026-03-31"),
        row("other", "d3", "2025-01-01", null),
        row("group", null, "2025-01-01", null),
      ],
      "d2",
      "2026-04-01",
    );
    expect(plan).toEqual({ toEnd: [], conflicts: [] });
  });

  it("reports rows starting today or later as conflicts", () => {
    const today = row("today", "d2", "2028-02-29", null);
    const future = row("future", "d2", "2028-03-05", "2028-04-01");
    expect(
      planPrimaryDepartmentChange([today, future], "d2", "2028-02-29"),
    ).toEqual({ toEnd: [], conflicts: [today, future] });
  });

  it("never plans an end before a start (property)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -400, max: 400 }),
        fc.option(fc.integer({ min: 0, max: 400 })),
        (startOffset, length) => {
          const today = "2026-06-15";
          const startDate = addDays(today, startOffset);
          const endDate = length === null ? null : addDays(startDate, length);
          const m = row("m", "d1", startDate, endDate);
          const plan = planPrimaryDepartmentChange([m], "d1", today);
          for (const { endDate: end } of plan.toEnd) {
            expect(end >= startDate).toBe(true);
            expect(end).toBe("2026-06-14");
          }
          expect(plan.toEnd.length + plan.conflicts.length).toBe(
            endDate !== null && endDate < today ? 0 : 1,
          );
        },
      ),
    );
  });
});
