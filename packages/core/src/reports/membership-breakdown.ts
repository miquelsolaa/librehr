import type { EmployeeSnapshot } from "./analytics.js";

export type BreakdownGroupBy = "department" | "group";
/**
 * "primary" counts the primary department only, so totals add up to the
 * headcount. "membership" also counts secondary memberships, so one person
 * can count in several rows and totals overlap.
 */
export type BreakdownBasis = "primary" | "membership";

/** A link from an employee to a department or group on the report date. */
export interface BreakdownLink {
  employeeId: string;
  targetType: "department" | "project" | "area";
  targetId: string;
  targetName: string;
  /** True for the primary department (employees.department_id). */
  primary: boolean;
  /** Secondary memberships only; null counts as 100%. */
  allocationPercent: number | null;
}

export interface BreakdownRow {
  type: "department" | "project" | "area";
  id: string;
  name: string;
  /** Distinct people. */
  headcount: number;
  /** Full-time equivalent: 1 per primary member, allocation/100 otherwise. */
  fte: number;
}

/** Same rule as the closing headcount of {@link calculateHeadcountMetrics}. */
function employedAt(emp: EmployeeSnapshot, date: string): boolean {
  const end = emp.terminationDate ?? null;
  return emp.hireDate <= date && (!end || end > date);
}

/**
 * Headcount and FTE per department or group on a calendar date (ORG-007,
 * RPT-001). Only people employed on `asOf` count; `links` must already be
 * limited to memberships active on that date. Groups have no primary
 * members, so `groupBy: "group"` always uses memberships.
 *
 * @example
 * calculateMembershipBreakdown(
 *   [{ id: "e1", hireDate: "2026-01-01" }],
 *   [{ employeeId: "e1", targetType: "project", targetId: "p1",
 *      targetName: "Launch", primary: false, allocationPercent: 50 }],
 *   "2026-06-30",
 *   { groupBy: "group", basis: "membership" },
 * ); // => [{ type: "project", id: "p1", name: "Launch", headcount: 1, fte: 0.5 }]
 */
export function calculateMembershipBreakdown(
  employees: readonly EmployeeSnapshot[],
  links: readonly BreakdownLink[],
  asOf: string,
  options: { groupBy: BreakdownGroupBy; basis: BreakdownBasis },
): BreakdownRow[] {
  const employed = new Set(
    employees.filter((e) => employedAt(e, asOf)).map((e) => e.id),
  );
  const rows = new Map<
    string,
    {
      row: Omit<BreakdownRow, "headcount" | "fte">;
      weights: Map<string, number>;
    }
  >();
  for (const link of links) {
    if (!employed.has(link.employeeId)) continue;
    const isDepartment = link.targetType === "department";
    if ((options.groupBy === "department") !== isDepartment) continue;
    if (options.basis === "primary" && !link.primary) continue;
    const weight = link.primary ? 1 : (link.allocationPercent ?? 100) / 100;
    const key = `${link.targetType}:${link.targetId}`;
    const entry = rows.get(key) ?? {
      row: { type: link.targetType, id: link.targetId, name: link.targetName },
      weights: new Map<string, number>(),
    };
    // One person counts once per row, with their largest share.
    const previous = entry.weights.get(link.employeeId) ?? 0;
    entry.weights.set(link.employeeId, Math.max(previous, weight));
    rows.set(key, entry);
  }
  return [...rows.values()]
    .map(({ row, weights }) => {
      let fte = 0;
      for (const w of weights.values()) fte += w;
      return {
        ...row,
        headcount: weights.size,
        fte: Math.round(fte * 100) / 100,
      };
    })
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
}
