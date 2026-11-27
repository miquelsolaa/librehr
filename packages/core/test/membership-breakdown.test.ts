import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  calculateHeadcountMetrics,
  calculateMembershipBreakdown,
  type BreakdownLink,
} from "../src/index.js";

const employees = [
  { id: "ana", hireDate: "2025-01-01" },
  { id: "ben", hireDate: "2025-01-01" },
  { id: "cal", hireDate: "2025-01-01", terminationDate: "2026-06-30" },
  { id: "dan", hireDate: "2026-07-01" },
];
const primary = (employeeId: string, id: string, name: string) =>
  ({
    employeeId,
    targetType: "department",
    targetId: id,
    targetName: name,
    primary: true,
    allocationPercent: null,
  }) satisfies BreakdownLink;
const secondary = (
  employeeId: string,
  targetType: BreakdownLink["targetType"],
  id: string,
  name: string,
  allocationPercent: number | null,
) =>
  ({
    employeeId,
    targetType,
    targetId: id,
    targetName: name,
    primary: false,
    allocationPercent,
  }) satisfies BreakdownLink;

const links: BreakdownLink[] = [
  primary("ana", "d-sales", "Sales"),
  primary("ben", "d-ops", "Ops"),
  primary("cal", "d-ops", "Ops"),
  secondary("ana", "department", "d-ops", "Ops", 25),
  secondary("ben", "project", "p-launch", "Launch", null),
  secondary("ana", "project", "p-launch", "Launch", 40),
  secondary("ana", "area", "a-risk", "Risk", 10),
];

describe("calculateMembershipBreakdown (ORG-007, RPT-001)", () => {
  it("counts primary departments only on the primary basis", () => {
    expect(
      calculateMembershipBreakdown(employees, links, "2026-06-30", {
        groupBy: "department",
        basis: "primary",
      }),
    ).toEqual([
      { type: "department", id: "d-ops", name: "Ops", headcount: 1, fte: 1 },
      {
        type: "department",
        id: "d-sales",
        name: "Sales",
        headcount: 1,
        fte: 1,
      },
    ]);
  });

  it("adds secondaries weighted by allocation on the membership basis", () => {
    const rows = calculateMembershipBreakdown(employees, links, "2026-06-30", {
      groupBy: "department",
      basis: "membership",
    });
    expect(rows.find((r) => r.id === "d-ops")).toMatchObject({
      headcount: 2,
      fte: 1.25,
    });
  });

  it("breaks down projects and areas, with a null allocation as 100%", () => {
    expect(
      calculateMembershipBreakdown(employees, links, "2026-06-30", {
        groupBy: "group",
        basis: "membership",
      }),
    ).toEqual([
      {
        type: "project",
        id: "p-launch",
        name: "Launch",
        headcount: 2,
        fte: 1.4,
      },
      { type: "area", id: "a-risk", name: "Risk", headcount: 1, fte: 0.1 },
    ]);
  });

  it("leaves out people not employed on the date", () => {
    const rows = calculateMembershipBreakdown(
      employees,
      [primary("cal", "d-ops", "Ops"), primary("dan", "d-ops", "Ops")],
      "2026-06-30",
      { groupBy: "department", basis: "primary" },
    );
    expect(rows).toEqual([]);
  });

  it("counts a person once per row, with their largest share", () => {
    const rows = calculateMembershipBreakdown(
      employees,
      [
        secondary("ana", "project", "p", "P", 30),
        secondary("ana", "project", "p", "P", 60),
      ],
      "2026-06-30",
      { groupBy: "group", basis: "membership" },
    );
    expect(rows).toEqual([
      { type: "project", id: "p", name: "P", headcount: 1, fte: 0.6 },
    ]);
  });

  it("primary totals equal the closing headcount of people with a department", () => {
    const ids = ["a", "b", "c", "d", "e"];
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            id: fc.constantFrom(...ids),
            dept: fc.constantFrom("d1", "d2", "d3"),
            hired: fc.boolean(),
            left: fc.boolean(),
          }),
        ),
        (people) => {
          const unique = [...new Map(people.map((p) => [p.id, p])).values()];
          const snapshots = unique.map((p) => ({
            id: p.id,
            hireDate: p.hired ? "2025-01-01" : "2027-01-01",
            terminationDate: p.left ? "2026-03-01" : null,
          }));
          const rows = calculateMembershipBreakdown(
            snapshots,
            unique.map((p) => primary(p.id, p.dept, p.dept)),
            "2026-06-30",
            { groupBy: "department", basis: "primary" },
          );
          const total = rows.reduce((sum, r) => sum + r.headcount, 0);
          const metrics = calculateHeadcountMetrics(
            snapshots,
            "2026-01-01",
            "2026-06-30",
          );
          expect(total).toBe(metrics.endingHeadcount);
          for (const r of rows) expect(r.fte).toBe(r.headcount);
        },
      ),
    );
  });
});
